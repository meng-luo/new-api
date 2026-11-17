/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

import { useAnnouncements } from '@/features/dashboard/hooks/use-status-data'
import type { AnnouncementItem } from '@/features/dashboard/types'
import { getNotice } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'
import {
  getNoticeReadKey,
  useNotificationStore,
} from '@/stores/notification-store'

function hashString(input: string): string {
  let hash = 0
  if (!input) return '0'

  for (let i = 0; i < input.length; i += 1) {
    const chr = input.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }

  return hash.toString(36)
}

/**
 * Generate a unique key for an announcement
 * Prefer backend id, fall back to a content hash so edits register
 */
function getAnnouncementKey(
  item: AnnouncementItem & { title?: string; link?: string }
): string {
  if (!item) return ''

  if (item.id !== undefined && item.id !== null) {
    return `id:${item.id}`
  }

  const fingerprint = JSON.stringify({
    publishDate: (item?.publishDate as string) || '',
    content: ((item?.content as string) || '').trim(),
    extra: ((item?.extra as string) || '').trim(),
    type: (item?.type as string) || '',
    title: ((item?.title as string) || '').trim(),
    link: ((item?.link as string) || '').trim(),
  })
  return `hash:${hashString(fingerprint)}`
}

/**
 * Hook to manage notifications (Notice + Announcements)
 * Provides unread counts and read status management
 */
export function useNotifications({ autoOpen = true } = {}) {
  const userId = useAuthStore((state) => state.auth.user?.id)
  const sessionId = useAuthStore((state) => state.auth.session?.sid)
  const sessionKey = userId ? `${userId}:${sessionId ?? ''}` : null
  const openedForSession = useRef<string | null>(null)
  const [openSession, setOpenSession] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'notice' | 'announcements'>(
    'notice'
  )

  // Fetch Notice from API
  const {
    data: noticeResponse,
    isLoading: noticeLoading,
    refetch: refetchNotice,
  } = useQuery({
    queryKey: ['notice', userId, sessionId],
    queryFn: async ({ signal }) =>
      requireServerSuccess(await getNotice(signal)),
    enabled: Boolean(userId),
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  const { items, loading: announcementsLoading } = useAnnouncements()
  const announcements = useMemo(() => items.slice(0, 20), [items])

  // Notification store
  const {
    lastReadNoticeKey,
    markNoticeRead,
    markAnnouncementsRead,
    readAnnouncementKeys,
  } = useNotificationStore()

  // Extract notice content
  const noticeContent =
    userId && noticeResponse?.success ? (noticeResponse.data || '').trim() : ''
  const noticeReadKey = useMemo(
    () => getNoticeReadKey(noticeContent),
    [noticeContent]
  )

  // Calculate unread counts
  const unreadCounts = useMemo(() => {
    const noticeUnread =
      noticeReadKey && noticeReadKey !== lastReadNoticeKey ? 1 : 0

    const announcementsUnread = announcements.filter((item) => {
      const key = getAnnouncementKey(item)
      return !readAnnouncementKeys.includes(key)
    }).length

    return {
      notice: noticeUnread,
      announcements: announcementsUnread,
      total: noticeUnread + announcementsUnread,
    }
  }, [noticeReadKey, lastReadNoticeKey, announcements, readAnnouncementKeys])

  const markAnnouncementsAsRead = () => {
    if (announcements.length > 0) {
      const allKeys = announcements.map((item) => getAnnouncementKey(item))
      markAnnouncementsRead(allKeys)
    }
  }

  // Handle popover open
  const handleOpenPopover = (tab?: 'notice' | 'announcements') => {
    if (!userId) return
    openedForSession.current = sessionKey
    const nextTab = tab || activeTab

    // Mark currently visible content as read when opening the notification center
    if (nextTab === 'notice' && noticeContent) {
      markNoticeRead(noticeContent)
    }
    if (nextTab === 'announcements') {
      markAnnouncementsAsRead()
    }

    setActiveTab(nextTab)
    setOpenSession(sessionKey)
  }

  const handlePopoverOpenChange = (open: boolean) => {
    if (open) {
      handleOpenPopover(activeTab)
      return
    }

    setOpenSession(null)
  }

  // Mark only the tab being viewed as read.
  const handleTabChange = (tab: 'notice' | 'announcements') => {
    setActiveTab(tab)

    if (tab === 'notice' && noticeContent) {
      markNoticeRead(noticeContent)
    }
    if (tab === 'announcements') {
      markAnnouncementsAsRead()
    }
  }

  const loading = Boolean(userId) && (noticeLoading || announcementsLoading)
  const openUnreadNotifications = useEffectEvent(() => {
    handleOpenPopover(unreadCounts.notice > 0 ? 'notice' : 'announcements')
  })

  useEffect(() => {
    if (!sessionKey) {
      openedForSession.current = null
      setOpenSession(null)
      return
    }
    if (
      !autoOpen ||
      loading ||
      unreadCounts.total === 0 ||
      openedForSession.current === sessionKey
    ) {
      return
    }

    openUnreadNotifications()
  }, [autoOpen, loading, sessionKey, unreadCounts.total])

  return {
    // Data
    notice: noticeContent,
    announcements,
    loading,

    // Unread counts
    unreadCount: unreadCounts.total,
    unreadNoticeCount: unreadCounts.notice,
    unreadAnnouncementsCount: unreadCounts.announcements,

    // Popover state
    popoverOpen: Boolean(userId) && openSession === sessionKey,
    setPopoverOpen: handlePopoverOpenChange,
    activeTab,
    setActiveTab: handleTabChange,

    // Actions
    openPopover: handleOpenPopover,
    closePopover: () => setOpenSession(null),
    refetchNotice: () => {
      if (userId) return refetchNotice()
    },
  }
}
