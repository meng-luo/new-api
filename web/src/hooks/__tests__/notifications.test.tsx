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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { NotificationPopover } from '@/components/notification-popover'
import { useAnnouncements } from '@/features/dashboard/hooks/use-status-data'
import { useNotifications } from '@/hooks/use-notifications'
import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'
import { useNotificationStore } from '@/stores/notification-store'

const announcement = { id: 1, content: 'Private timeline update' }
let client: QueryClient

function Wrapper(props: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
  )
}

function Notifications() {
  const notifications = useNotifications()
  return (
    <NotificationPopover
      open={notifications.popoverOpen}
      onOpenChange={notifications.setPopoverOpen}
      unreadCount={notifications.unreadCount}
      activeTab={notifications.activeTab}
      onTabChange={notifications.setActiveTab}
      notice={notifications.notice}
      announcements={notifications.announcements}
      loading={notifications.loading}
    />
  )
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  useAuthStore.getState().auth.reset()
  useNotificationStore.setState({
    lastReadNoticeKey: '',
    readAnnouncementKeys: [],
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(STATUS_QUERY_KEY, {
    announcements_enabled: true,
    announcements: [announcement],
  })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/notice') {
      return { data: { success: true, data: 'Private system notice' } }
    }
    if (url === '/api/announcements') {
      return { data: { success: true, data: [announcement] } }
    }
    throw new Error(`Unexpected GET ${url}`)
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  useAuthStore.getState().auth.reset()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

test('anonymous visitors cannot see notifications or request private content, including cached content', () => {
  client.setQueryData(['notice'], {
    success: true,
    data: 'Cached private notice',
  })
  const hook = renderHook(
    () => ({
      notifications: useNotifications(),
      dashboard: useAnnouncements(),
    }),
    { wrapper: Wrapper }
  )
  render(<Notifications />, { wrapper: Wrapper })

  expect(
    screen.queryByRole('button', { name: 'Notifications' })
  ).not.toBeInTheDocument()
  expect(hook.result.current.notifications.notice).toBe('')
  expect(hook.result.current.notifications.announcements).toEqual([])
  expect(hook.result.current.dashboard.items).toEqual([])
  expect(api.get).not.toHaveBeenCalled()
})

test('signing in loads both tabs and signing out immediately hides the open notification center', async () => {
  const user = userEvent.setup()
  render(<Notifications />, { wrapper: Wrapper })
  act(() =>
    useAuthStore.getState().auth.setUser({ id: 1, username: 'reader', role: 1 })
  )
  expect(await screen.findByText('Private system notice')).toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'Timeline' }))
  expect(await screen.findByText(announcement.content)).toBeVisible()
  expect(window.localStorage.getItem('notification-storage')).not.toContain(
    'Private system notice'
  )

  act(() => useAuthStore.getState().auth.reset())
  expect(
    screen.queryByRole('button', { name: 'Notifications' })
  ).not.toBeInTheDocument()
  expect(screen.queryByText(announcement.content)).not.toBeInTheDocument()
})

test('dashboard and notification consumers share the authenticated timeline request', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'reader', role: 1 })
  const hook = renderHook(
    () => ({
      notifications: useNotifications(),
      dashboard: useAnnouncements(),
    }),
    { wrapper: Wrapper }
  )
  await waitFor(() =>
    expect(hook.result.current.dashboard.items).toEqual([announcement])
  )
  expect(hook.result.current.notifications.announcements).toEqual([
    announcement,
  ])
  expect(
    vi
      .mocked(api.get)
      .mock.calls.filter(([url]) => url === '/api/announcements')
  ).toHaveLength(1)

  act(() => useAuthStore.getState().auth.reset())
  expect(hook.result.current.notifications.notice).toBe('')
  expect(hook.result.current.notifications.announcements).toEqual([])
  expect(hook.result.current.dashboard.items).toEqual([])
})

test('legacy notification storage discards persisted notice content on hydration', async () => {
  window.localStorage.setItem(
    'notification-storage',
    JSON.stringify({
      version: 0,
      state: {
        lastReadNotice: 'Private system notice',
        readAnnouncementKeys: [],
        closedUntilDate: null,
      },
    })
  )
  await useNotificationStore.persist.rehydrate()
  expect(useNotificationStore.getState().lastReadNoticeKey).toBe('')
  expect(window.localStorage.getItem('notification-storage')).not.toContain(
    'Private system notice'
  )
})

test('failed authenticated timeline requests cannot fall back to the public status snapshot', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'reader', role: 1 })
  vi.mocked(api.get).mockRejectedValueOnce(new Error('Session expired'))
  const hook = renderHook(() => useAnnouncements(), { wrapper: Wrapper })
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  expect(hook.result.current.items).toEqual([])
})

test('changing accounts cannot reuse the previous account notification cache', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'reader', role: 1 })
  const hook = renderHook(() => useNotifications(), { wrapper: Wrapper })
  await waitFor(() =>
    expect(hook.result.current.notice).toBe('Private system notice')
  )
  vi.mocked(api.get).mockResolvedValue({ data: { success: false } })
  act(() =>
    useAuthStore
      .getState()
      .auth.setUser({ id: 2, username: 'another-reader', role: 1 })
  )
  expect(hook.result.current.notice).toBe('')
  expect(hook.result.current.announcements).toEqual([])
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
})

test('only unread timeline entries automatically open the timeline and clear its unread count', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'reader', role: 1 })
  useNotificationStore.getState().markNoticeRead('Private system notice')
  render(<Notifications />, { wrapper: Wrapper })

  expect(await screen.findByText(announcement.content)).toBeVisible()
  expect(screen.getByRole('tab', { name: 'Timeline' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(
    screen.getByRole('button', { name: 'Notifications' })
  ).not.toHaveTextContent(/\d/)
})

test('closing the automatically opened notice leaves unread timeline entries without reopening', async () => {
  const user = userEvent.setup()
  useAuthStore.getState().auth.setUser({ id: 1, username: 'reader', role: 1 })
  const view = render(<Notifications />, { wrapper: Wrapper })
  expect(await screen.findByText('Private system notice')).toBeVisible()
  expect(screen.getByRole('tab', { name: 'Notice' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await user.click(screen.getByRole('button', { name: /^Close$/ }))
  view.rerender(<Notifications />)

  expect(screen.getByRole('button', { name: 'Notifications' })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  expect(
    screen.getByRole('button', { name: 'Notifications' })
  ).toHaveTextContent('1')
})

test('already read content stays closed and can still be opened manually', async () => {
  const user = userEvent.setup()
  useAuthStore.getState().auth.setUser({ id: 1, username: 'reader', role: 1 })
  useNotificationStore.getState().markNoticeRead('Private system notice')
  useNotificationStore.getState().markAnnouncementsRead(['id:1'])
  const hook = renderHook(() => useNotifications(), { wrapper: Wrapper })
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  render(<Notifications />, { wrapper: Wrapper })
  expect(screen.getByRole('button', { name: 'Notifications' })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await user.click(screen.getByRole('button', { name: 'Notifications' }))
  expect(await screen.findByText('Private system notice')).toBeVisible()
})

test('automatic opening waits for both requests before choosing the unread notice', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'reader', role: 1 })
  let resolveNotice!: (value: {
    data: { success: boolean; data: string }
  }) => void
  const noticeResponse = new Promise<{
    data: { success: boolean; data: string }
  }>((resolve) => {
    resolveNotice = resolve
  })
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/api/notice') return noticeResponse
    return { data: { success: true, data: [announcement] } }
  })
  const hook = renderHook(() => useNotifications(), { wrapper: Wrapper })
  await waitFor(() =>
    expect(hook.result.current.announcements).toEqual([announcement])
  )
  expect(hook.result.current.popoverOpen).toBe(false)
  await act(async () =>
    resolveNotice({ data: { success: true, data: 'Private system notice' } })
  )
  await waitFor(() => expect(hook.result.current.popoverOpen).toBe(true))
  expect(hook.result.current.activeTab).toBe('notice')
  expect(hook.result.current.unreadNoticeCount).toBe(0)
  expect(hook.result.current.unreadAnnouncementsCount).toBe(1)
})

test('a hidden notification center does not automatically open or mark unread content as read', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'reader', role: 1 })
  const hook = renderHook(() => useNotifications({ autoOpen: false }), {
    wrapper: Wrapper,
  })
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  expect(hook.result.current.popoverOpen).toBe(false)
  expect(hook.result.current.unreadCount).toBe(2)
})

test('signing out closes an automatically opened panel before the same user signs in again', async () => {
  const reader = { id: 1, username: 'reader', role: 1 }
  useAuthStore.getState().auth.setUser(reader)
  const hook = renderHook(() => useNotifications(), { wrapper: Wrapper })
  await waitFor(() => expect(hook.result.current.popoverOpen).toBe(true))
  act(() => hook.result.current.setActiveTab('announcements'))
  expect(hook.result.current.unreadCount).toBe(0)
  act(() => useAuthStore.getState().auth.reset())
  act(() => useAuthStore.getState().auth.setUser(reader))
  expect(hook.result.current.popoverOpen).toBe(false)
})

test.each([
  { name: 'unchanged', suffix: 'first version', opens: false },
  { name: 'updated', suffix: 'second version', opens: true },
])(
  '$name notice keeps the correct read state after a page reload',
  async ({ suffix, opens }) => {
    const prefix = 'Private announcement content '.repeat(8)
    const originalNotice = `${prefix}first version`
    useAuthStore.getState().auth.setUser({ id: 1, username: 'reader', role: 1 })
    useNotificationStore.getState().markAnnouncementsRead(['id:1'])
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/api/notice') {
        return { data: { success: true, data: originalNotice } }
      }
      return { data: { success: true, data: [announcement] } }
    })
    const firstPage = renderHook(() => useNotifications(), { wrapper: Wrapper })
    await waitFor(() => expect(firstPage.result.current.popoverOpen).toBe(true))
    act(() => firstPage.result.current.closePopover())
    firstPage.unmount()
    const persisted = window.localStorage.getItem('notification-storage') ?? ''
    expect(persisted).not.toContain(originalNotice)

    // Recreate the in-memory state and restore only what survives a reload.
    useNotificationStore.setState(useNotificationStore.getInitialState(), true)
    window.localStorage.setItem('notification-storage', persisted)
    await useNotificationStore.persist.rehydrate()
    client.removeQueries({ queryKey: ['notice'] })
    client.removeQueries({ queryKey: ['announcements'] })
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/api/notice') {
        return { data: { success: true, data: `  ${prefix}${suffix}  ` } }
      }
      return { data: { success: true, data: [announcement] } }
    })
    const refreshedPage = renderHook(() => useNotifications(), {
      wrapper: Wrapper,
    })
    await waitFor(() =>
      expect(refreshedPage.result.current.loading).toBe(false)
    )
    expect(refreshedPage.result.current.popoverOpen).toBe(opens)
    expect(refreshedPage.result.current.unreadCount).toBe(0)
    expect(window.localStorage.getItem('notification-storage')).not.toContain(
      prefix
    )
  }
)
