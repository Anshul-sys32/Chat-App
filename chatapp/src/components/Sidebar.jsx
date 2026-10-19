import React, { useState } from 'react';
import axios from 'axios';
import {
  FaUsers,
  FaLayerGroup,
  FaTimes,
  FaBars,
  FaShieldAlt,
  FaUserEdit,
  FaMoon,
  FaSun
} from 'react-icons/fa';
import UserList from './UserList';
import GroupList from './GroupList';
import Socket from '../Socket';
import ProfileEditor from './ProfileEditor';

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";

const Sidebar = ({ isOpen, toggleSidebar, onCloseSidebar, onSelectChat, onOpenAdmin, user, onUserUpdated, theme, onToggleTheme }) => {
  const [activeTab, setActiveTab] = useState('users');
  const [search, setSearch] = useState('');
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const handleSelectChat = (chat) => {
    onSelectChat(chat);
    setIsProfileOpen(false);
    if (window.matchMedia('(max-width: 639px)').matches) onCloseSidebar();
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'users':
        return <UserList search={search} onStartChat={handleSelectChat} />;
      case 'groups':
        return <GroupList search={search} onSelectGroup={handleSelectChat} />;
      default:
        return null;
    }
  };

  return (
    <>
      {/* Floating FaBars when sidebar is closed */}
      <div
        className={`fixed top-4 left-4 z-50 transition-opacity duration-300 ease-in-out ${
          isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <button
          onClick={toggleSidebar}
          className="theme-menu-button rounded-lg p-2 shadow-md"

          title="Open Menu"
        >
          <FaBars size={20} />
        </button>
      </div>

      {/* Sidebar Container */}
      <div
        style={{ height: 'var(--app-height, 100dvh)' }}
        className={`theme-sidebar fixed left-0 top-0 z-40 flex min-h-0 transform shadow-2xl backdrop-blur-2xl transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Left Nav Icons */}
        <div className="glass-rail relative z-20 flex w-16 flex-col items-center space-y-4 py-10">
          {/* FaTimes to close */}
          <div className="absolute top-4 left-5">
            <button
              onClick={toggleSidebar}
              className="theme-text hover:text-teal-500"
              title="Close Menu"
            >
              <FaTimes size={20} />
            </button>
          </div>

          <div className="mt-10 space-y-4">
            <IconButton
              icon={<FaUsers />}
              label="Users"
              onClick={() => setActiveTab('users')}
              active={activeTab === 'users'}
            />
            <IconButton
              icon={<FaLayerGroup />}
              label="Groups"
              onClick={() => setActiveTab('groups')}
              active={activeTab === 'groups'}
            />
            {user?.role === 'admin' && <IconButton
              icon={<FaShieldAlt />}
              label="Admin"
              onClick={onOpenAdmin}
              active={false}
            />}
            <IconButton
              icon={theme === "dark" ? <FaSun /> : <FaMoon />}
              label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              onClick={onToggleTheme}
              active={false}
            />
          </div>
        </div>

        {/* Dynamic Content Area */}
        <div className="theme-sidebar-panel glass-panel relative z-0 flex h-full min-h-0 w-[calc(100vw-4rem)] flex-col overflow-hidden border-l-0 sm:w-72">
          {/* Search Input + List */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="glass-input theme-text mb-4 w-full rounded-lg p-2.5 placeholder:opacity-60 focus:outline-none focus:ring-2 focus:ring-teal-300/60"
            />
            {renderContent()}
          </div>

          {/* Footer */}
          <div className="theme-sidebar-footer shrink-0 border-t px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
            <button type="button" onClick={() => setIsProfileOpen(true)} className="flex w-full min-w-0 items-center gap-2 rounded-lg p-2 text-left transition hover:bg-white/[0.08]" title="Edit your profile">
              <span className="theme-profile-icon grid h-9 w-9 shrink-0 place-items-center rounded-full"><FaUserEdit size={15} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{user?.username || 'Guest'}</span>
                <span className="theme-muted block text-xs">Edit profile</span>
              </span>
            </button>
            <button
              onClick={async () => {
                try {
                  await axios.post(`${API_URL}/api/logout`, {}, { withCredentials: true });
                } catch (error) {
                  console.error('Could not clear the server session:', error);
                }
                localStorage.removeItem('user');
                localStorage.removeItem('token');
                localStorage.removeItem('selectedChat');
                Socket.disconnect();
                window.location.reload();
              }}
              className="theme-logout mt-2 w-full rounded-lg px-3 py-2 text-center text-sm transition"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
      {isProfileOpen && user && (
        <ProfileEditor
          user={user}
          onClose={() => setIsProfileOpen(false)}
          onSaved={onUserUpdated}
        />
      )}
    </>
  );
};

const IconButton = ({ icon, label, onClick, active }) => (
  <div className="group relative z-10 hover:z-[100]">
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`theme-icon-button rounded-lg p-2 text-xl transition ${
        active ? 'is-active' : ''
      }`}
    >
      {icon}
    </button>
    <span className="theme-tooltip absolute left-full top-1/2 z-[110] ml-2 origin-left -translate-y-1/2 scale-0 whitespace-nowrap rounded px-2 py-1 text-xs shadow-lg transition-transform group-hover:scale-100">
      {label}
    </span>
  </div>
);

export default Sidebar;
