import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import Socket from '../Socket';
import Avatar from './Avatar';

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";

export default function UserList({ currentUser, onStartChat, search = '', scope = 'global', activeChatId }) {
  const [allUsers, setAllUsers] = useState([]);
  const [onlineUserIds, setOnlineUserIds] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextCursor = useRef(null);

  useEffect(() => {
    if (!currentUser) return;
    nextCursor.current = null;
    setAllUsers([]);

    const fetchUsers = async () => {
      try {
        const params = new URLSearchParams({ scope, limit: scope === 'global' ? '30' : '100' });
        const res = await axios.get(`${API_URL}/api/users?${params}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          withCredentials: true,
        });
        const payload = Array.isArray(res.data) ? { users: res.data, hasMore: false } : res.data;
        const others = payload.users.filter((u) => String(u._id) !== String(currentUser._id));
        setAllUsers(others);
        setHasMore(Boolean(payload.hasMore));
        nextCursor.current = others.length
          ? { username: others[others.length - 1].username, id: Number(others[others.length - 1]._id) }
          : null;
      } catch (err) {
        console.error("Failed to fetch users:", err);
      }
    };

    fetchUsers();
  }, [currentUser, scope]);

  const loadMore = async () => {
    if (!currentUser || scope !== 'global' || !hasMore || loadingMore || !nextCursor.current) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        scope,
        limit: '30',
        cursor: JSON.stringify(nextCursor.current),
      });
      const res = await axios.get(`${API_URL}/api/users?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        withCredentials: true,
      });
      const payload = Array.isArray(res.data) ? { users: res.data, hasMore: false } : res.data;
      const others = payload.users.filter((u) => String(u._id) !== String(currentUser._id));
      setAllUsers((previous) => [...previous, ...others]);
      setHasMore(Boolean(payload.hasMore));
      nextCursor.current = others.length
        ? { username: others[others.length - 1].username, id: Number(others[others.length - 1]._id) }
        : null;
    } catch (err) {
      console.error("Failed to load more users:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const handleOnlineUsers = (ids) => {
      setOnlineUserIds(ids);
    };

    Socket.on('online-users', handleOnlineUsers);
    return () => Socket.off('online-users', handleOnlineUsers);
  }, []);

  useEffect(() => {
    const handleProfilePicture = ({ userId, profilePicture }) => {
      setAllUsers((previous) => previous.map((candidate) =>
        String(candidate._id) === String(userId) ? { ...candidate, profilePicture } : candidate
      ));
    };
    const handleIncomingMessage = (message) => {
      if (String(message.receiver) !== String(currentUser?._id)) return;
      setAllUsers((previous) => previous.map((candidate) =>
        String(candidate._id) === String(message.sender)
          ? { ...candidate, unreadCount: String(candidate._id) === String(activeChatId) ? 0 : Number(candidate.unreadCount || 0) + 1 }
          : candidate
      ));
    };
    Socket.on('profile-picture-updated', handleProfilePicture);
    Socket.on('receive-message', handleIncomingMessage);
    return () => {
      Socket.off('profile-picture-updated', handleProfilePicture);
      Socket.off('receive-message', handleIncomingMessage);
    };
  }, [activeChatId, currentUser?._id]);

  useEffect(() => {
    if (!activeChatId) return;
    setAllUsers((previous) => previous.map((candidate) =>
      String(candidate._id) === String(activeChatId) ? { ...candidate, unreadCount: 0 } : candidate
    ));
  }, [activeChatId]);

  const handleStartChat = (selectedUser) => {
    if (onStartChat) onStartChat(selectedUser);
  };

  const filteredUsers = currentUser ? allUsers : [];
  const visibleUsers = filteredUsers.filter((candidate) =>
    `${candidate.username} ${candidate.email}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="text-white">
      <h3 className="text-lg font-semibold mb-2">{scope === 'local' ? 'Local Users' : 'Global Users'}</h3>

      <ul
        onScroll={(event) => {
          const element = event.currentTarget;
          if (element.scrollHeight - element.scrollTop - element.clientHeight < 120) loadMore();
        }}
        className="space-y-2 max-h-[calc(100vh-150px)] overflow-y-auto pr-1"
      >
        {visibleUsers.length === 0 ? (
          <p className="text-sm text-gray-400">No users found.</p>
        ) : (
          visibleUsers.map((user) => {
            const isOnline = onlineUserIds.includes(String(user._id));

            return (
              <li
                key={user._id}
                onClick={() => handleStartChat(user)}
                className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.045] px-3 py-2.5 transition hover:border-teal-200/20 hover:bg-teal-300/[0.08]"
                tabIndex={0}
                role="button"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') handleStartChat(user);
                }}
              >
                <Avatar src={user.profilePicture || user.googlePicture} name={user.username} className="h-10 w-10 text-sm" />
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate font-medium">{user.username}</p>
                  <p className="truncate text-xs text-gray-300">{user.email}</p>
                </div>
                {isOnline && (
                  <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-green-500" title="Online"></span>
                )}
                {Number(user.unreadCount) > 0 && String(user._id) !== String(activeChatId) && (
                  <span className="grid min-h-5 min-w-5 shrink-0 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white" title={`${user.unreadCount} unread message${user.unreadCount === 1 ? '' : 's'}`}>
                    {user.unreadCount > 99 ? '99+' : user.unreadCount}
                  </span>
                )}
              </li>
            );
          })
        )}
        {loadingMore && <p className="py-2 text-center text-xs text-gray-400">Loading more users…</p>}
      </ul>
    </div>
  );
}
