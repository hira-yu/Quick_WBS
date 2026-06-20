import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectEvent, ProjectEventResponse } from "./types";

export type RealtimeStatus = "connecting" | "checking" | "current" | "updated" | "retrying" | "paused";

type UseProjectRealtimeOptions = {
  channelKey: string;
  enabled: boolean;
  currentActorId?: string | null;
  fetchEvents: (since?: number) => Promise<ProjectEventResponse>;
  onEvents: (events: ProjectEvent[]) => Promise<void> | void;
};

const NORMAL_INTERVAL_MS = 3000;
const LOCAL_EVENT_GRACE_MS = 5000;
const MAX_RETRY_INTERVAL_MS = 30000;

type LocalMutation = {
  eventType: string;
  targetId: string;
  recordedAt: number;
};

export function useProjectRealtime({
  channelKey,
  enabled,
  currentActorId,
  fetchEvents,
  onEvents,
}: UseProjectRealtimeOptions) {
  const [status, setStatus] = useState<RealtimeStatus>(enabled ? "connecting" : "paused");
  const latestEventIdRef = useRef<number | undefined>(undefined);
  const localMutationsRef = useRef<LocalMutation[]>([]);
  const fetchEventsRef = useRef(fetchEvents);
  const onEventsRef = useRef(onEvents);

  useEffect(() => {
    fetchEventsRef.current = fetchEvents;
  }, [fetchEvents]);

  useEffect(() => {
    onEventsRef.current = onEvents;
  }, [onEvents]);

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
    if (!enabled || !channelKey) {
      setStatus("paused");
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
        setStatus("paused");
        return;
      }

      polling = true;
      setStatus(latestEventIdRef.current === undefined ? "connecting" : "checking");
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

        if (externalEvents.length > 0) {
          await onEventsRef.current(externalEvents);
          if (!cancelled) setStatus("updated");
        } else {
          setStatus("current");
        }
        schedule(NORMAL_INTERVAL_MS);
      } catch {
        if (cancelled) return;
        consecutiveErrors += 1;
        setStatus("retrying");
        schedule(Math.min(MAX_RETRY_INTERVAL_MS, NORMAL_INTERVAL_MS * 2 ** consecutiveErrors));
      } finally {
        polling = false;
      }
    };

    const handleVisibilityChange = () => {
      if (timerId !== undefined) window.clearTimeout(timerId);
      if (document.hidden) {
        setStatus("paused");
      } else {
        void poll();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void poll();

    return () => {
      cancelled = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [channelKey, currentActorId, enabled]);

  return { status, markLocalMutation };
}
