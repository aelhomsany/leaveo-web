import { useQuery } from '@tanstack/react-query'
import { previewLeaveRequest } from '../../api/client'
import { useAuth } from '../../auth/useAuth'
import { FULL_DAY, type DayPart } from '../../lib/leaveDays'

export function useLeaveRequestPreview(
  dateFrom: string,
  dateTo: string,
  leaveTypeId?: number,
  startPart: DayPart = FULL_DAY,
  endPart: DayPart = FULL_DAY,
) {
  const { user } = useAuth()
  const userId = user?.id
  const datesValid =
    dateFrom !== '' && dateTo !== '' && dateTo >= dateFrom

  return useQuery({
    // Plan MEDIA: the parts are part of the key, not just the payload. The same range costs a
    // different number of days depending on them, so a cached whole-day preview must not be
    // shown for a request that now starts after lunch.
    queryKey: ['leave-requests', 'preview', userId, dateFrom, dateTo, leaveTypeId, startPart, endPart],
    // The server rejects a preview for a deactivated type, so the selected type travels with
    // the request: without it the user gets a clean working-day count and only discovers the
    // type is gone when submit fails.
    queryFn: () => previewLeaveRequest({ dateFrom, dateTo, leaveTypeId, startPart, endPart }),
    enabled: userId != null && datesValid,
    staleTime: 30_000,
  })
}
