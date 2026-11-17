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
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface NotificationState {
  // Persist only the fingerprint of the last read notice, never its content.
  lastReadNoticeKey: string
  // Array of read announcement keys (id or content hash)
  readAnnouncementKeys: string[]
  // Timestamp of last "Close Today" action
  closedUntilDate: string | null

  // Actions
  markNoticeRead: (noticeContent: string) => void
  markAnnouncementsRead: (keys: string[]) => void
  setClosedUntilDate: (date: string | null) => void
  isAnnouncementRead: (key: string) => boolean
  isNoticeClosed: () => boolean
}

export function getNoticeReadKey(content: string): string {
  const normalizedContent = content.trim()
  if (!normalizedContent) return ''

  // FNV-1a provides a stable 64-bit change marker without storing the text.
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < normalizedContent.length; i += 1) {
    hash ^= BigInt(normalizedContent.charCodeAt(i))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `notice:${hash.toString(16)}`
}

/**
 * Notification store for tracking read status of Notice and Announcements
 * Persists to localStorage to maintain state across sessions
 */
export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      lastReadNoticeKey: '',
      readAnnouncementKeys: [],
      closedUntilDate: null,

      markNoticeRead: (noticeContent: string) => {
        set({ lastReadNoticeKey: getNoticeReadKey(noticeContent) })
      },

      markAnnouncementsRead: (keys: string[]) => {
        set((state) => ({
          readAnnouncementKeys: [
            ...new Set([...state.readAnnouncementKeys, ...keys]),
          ],
        }))
      },

      setClosedUntilDate: (date: string | null) => {
        set({ closedUntilDate: date })
      },

      isAnnouncementRead: (key: string) => {
        return get().readAnnouncementKeys.includes(key)
      },

      isNoticeClosed: () => {
        const { closedUntilDate } = get()
        if (!closedUntilDate) return false

        const today = new Date().toDateString()
        return closedUntilDate === today
      },
    }),
    {
      name: 'notification-storage',
      version: 1,
      // Discard legacy snapshots that persisted the full private notice.
      migrate: (): Pick<
        NotificationState,
        'lastReadNoticeKey' | 'readAnnouncementKeys' | 'closedUntilDate'
      > => ({
        lastReadNoticeKey: '',
        readAnnouncementKeys: [],
        closedUntilDate: null,
      }),
      partialize: (state) => ({
        lastReadNoticeKey: state.lastReadNoticeKey,
        readAnnouncementKeys: state.readAnnouncementKeys,
        closedUntilDate: state.closedUntilDate,
      }),
    }
  )
)
