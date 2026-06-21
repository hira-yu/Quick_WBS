import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectEvent, ProjectEventResponse } from "./types";

export type RealtimeStatus = "connecting" | "checking" | "current" | "updated" | "retrying" | "paused";

type UseProjectRealtimeOptions = {
  channelKey: string;
  enabled: boolean;
  interactionActive?: boolean;
  currentActorId?: string | null;
  fetchEvents: (since?: number) => Promise<ProjectEventResponse>;
  onEvents: (events: ProjectEvent[]) => Promise<void> | void;
};

const NORMAL_INTERVAL_MS = 3000;
const EDITING_INTERVAL_MS = 12000;
const LOCAL_EVENT_GRACE_MS = 15000;
const MAX_RETRY_INTERVAL_MS = 30000;

type LocalMutation = {
  eventType: string;
  targetId: string;
  recordedAt: number;
};

export function useProjectRealtime({
  channelKey,
  enabled,
  interactionActive = false,
  currentActorId,
  fetchEvents,
  onEvents,
}: UseProjectRealtimeOptions) {
  const [status, setStatus] = useState<RealtimeStatus>(enabled ? "connecting" : "paused");
  const statusRef = useRef(status);
  const latestEventIdRef = useRef<number | undefined>(undefined);
  const localMutationsRef = useRef<LocalMutation[]>([]);
  const deferredEventsRef = useRef<ProjectEvent[]>([]);
  const fetchEventsRef = useRef(fetchEvents);
  const onEventsRef = useRef(onEvents);
  const interactionActiveRef = useRef(interactionActive);

  const updateStatus = useCallback((next: RealtimeStatus) => {
    if (statusRef.current === next) return;
    statusRef.current = next;
    setStatus(next);
  }, []);

  useEffect(() => {
    fetchEventsRef.current = fetchEvents;
  }, [fetchEvents]);

  useEffect(() => {
    onEventsRef.current = onEvents;
  }, [onEvents]);

  useEffect(() => {
    interactionActiveRef.current = interactionActive;
  }, [interactionActive]);

  const markLocalMutation = useCallback((eventType: string, targetId: string) => {
    const now = Date.now();
    localMutationsRef.current = [
      ...localMutationsRef.current.filter((mutation) => now - mutation.recordedAt < LOCAL_EVENT_GRACE_MS),
      { eventType, targetId, recordedAt: now },
    ];
  }, []);

  useEffect(() => {
    latestEventIdRef.current = undefined;
    localMutationsRef.current = [];
    deferredEventsRef.current = [];
    if (!enabled || !channelKey) {
      updateStatus("paused");
      return;
    }

    let cancelled = false;
    let timerId: number | undefined;
    let consecutiveErrors = 0;
    let polling = false;

    const schedule = (delay: number) => {
      if (!cancelled) {
        timerId = window.setTimeout(() => void poll(), delay);
      }
    };

    const poll = async () => {
      if (cancelled || polling) return;
      if (document.hidden) {
        updateStatus("paused");
        return;
      }

      polling = true;
      if (latestEventIdRef.current === undefined) updateStatus("connecting");
      try {
        const response = await fetchEventsRef.current(latestEventIdRef.current);
        if (cancelled) return;

        latestEventIdRef.current = response.latest_event_id;
        consecutiveErrors = 0;
        const now = Date.now();
        const pendingLocalMutations = localMutationsRef.current.filter(
          (mutation) => now - mutation.recordedAt < LOCAL_EVENT_GRACE_MS,
        );
        const externalEvents = response.events.filter((event) => {
          const localIndex = pendingLocalMutations.findIndex(
            (mutation) =>
              mutation.eventType === event.event_type
              && mutation.targetId === event.target_id
              && (!currentActorId || event.actor_user_id === currentActorId),
          );
          if (localIndex < 0) return true;
          pendingLocalMutations.splice(localIndex, 1);
          return false;
        });
        localMutationsRef.current = pendingLocalMutations;

        const focusedElement = document.activeElement;
        const formFocused = focusedElement instanceof HTMLInputElement
          || focusedElement instanceof HTMLTextAreaElement
          || focusedElement instanceof HTMLSelectElement
          || (focusedElement instanceof HTMLElement && focusedElement.isContentEditable);
        const editing = interactionActiveRef.current || formFocused;

        if (externalEvents.length > 0 && editing) {
          deferredEventsRef.current.push(...externalEvents);
        } else if (externalEvents.length > 0 || (deferredEventsRef.current.length > 0 && !editing)) {
          const events = [...deferredEventsRef.current, ...externalEvents];
          deferredEventsRef.current = [];
          await onEventsRef.current(events);
          if (!cancelled) updateStatus("updated");
        } else {
          updateStatus("current");
        }
        schedule(editing ? EDITING_INTERVAL_MS : NORMAL_INTERVAL_MS);
      } catch {
        if (cancelled) return;
        consecutiveErrors += 1;
        updateStatus("retrying");
        schedule(Math.min(MAX_RETRY_INTERVAL_MS, NORMAL_INTERVAL_MS * 2 ** consecutiveErrors));
      } finally {
        polling = false;
      }
    };

    const handleVisibilityChange = () => {
      if (timerId !== undefined) window.clearTimeout(timerId);
      if (document.hidden) {
        updateStatus("paused");
      } else {
        void poll();
      }
    };

    const handleFocusOut = () => {
      window.setTimeout(() => {
        if (cancelled || document.hidden) return;
        if (timerId !== undefined) window.clearTimeout(timerId);
        void poll();
      }, 100);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("focusout", handleFocusOut);
    void poll();

    return () => {
      cancelled = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, [channelKey, currentActorId, enabled, updateStatus]);

  return { status, markLocalMutation };
}
