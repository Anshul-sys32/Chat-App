import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Socket from '../Socket';
import Avatar from './Avatar';

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";

export default function UserList({ currentUser, onStartChat, search = '' }) {
  const [allUsers, setAllUsers] = useState([]);
  const [onlineUserIds, setOnlineUserIds] = useState([]);

  useEffect(() => {
    if (!currentUser) return;

    const fetchUsers = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/users`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          withCredentials: true,
        });
        const others = res.data.filter((u) => String(u._id) !== String(currentUser._id));
        setAllUsers(others);
      } catch (err) {
        console.error("Failed to fetch users:", err);
      }
    };

    fetchUsers();
  }, [currentUser]);

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
    Socket.on('profile-picture-updated', handleProfilePicture);
    return () => Socket.off('profile-picture-updated', handleProfilePicture);
  }, []);

  const handleStartChat = (selectedUser) => {
    if (onStartChat) onStartChat(selectedUser);
  };

  const filteredUsers = currentUser ? allUsers : [];
  const visibleUsers = filteredUsers.filter((candidate) =>
    `${candidate.username} ${candidate.email}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="text-white">
      <h3 className="text-lg font-semibold mb-2">Users</h3>

      <ul className="space-y-2 max-h-[calc(100vh-150px)] overflow-y-auto pr-1">
        {visibleUsers.length === 0 ? (
          <p className="text-sm text-gray-400">No users found.</p>
        ) : (
          visibleUsers.map((user) => {
            const isOnline = onlineUserIds.includes(String(user._id));

            return (
              <li
                key={user._id}
                onClick={() => handleStartChat(user)}
                className="flex cursor-pointer items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.045] px-3 py-2.5 transition hover:border-teal-200/20 hover:bg-teal-300/[0.08]"
                tabIndex={0}
                role="button"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') handleStartChat(user);
                }}
              >
                <Avatar src={user.profilePicture || user.googlePicture} name={user.username} className="h-10 w-10 text-sm" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{user.username}</p>
                  <p className="truncate text-xs text-gray-300">{user.email}</p>
                </div>
                {isOnline && (
                  <span className="ml-2 h-2 w-2 bg-green-500 rounded-full" title="Online"></span>
                )}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
