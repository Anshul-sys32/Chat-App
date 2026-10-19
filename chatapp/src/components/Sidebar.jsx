import React, { useState } from 'react';
import axios from 'axios';
import {
  FaUsers,
  FaLayerGroup,
  FaTimes,
  FaBars,
  FaShieldAlt
} from 'react-icons/fa';
import UserList from './UserList';
import GroupList from './GroupList';
import Socket from '../Socket';

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";

const Sidebar = ({ isOpen, toggleSidebar, onSelectChat, onOpenAdmin }) => {
  const [activeTab, setActiveTab] = useState('users');
  const [search, setSearch] = useState('');
  let user = null;
  try {
    user = JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'users':
        return <UserList search={search} onStartChat={onSelectChat} />;
      case 'groups':
        return <GroupList search={search} onSelectGroup={onSelectChat} />;
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
          className="bg-gray-800 p-2 rounded-md text-white shadow-md hover:bg-gray-700"

          title="Open Menu"
        >
          <FaBars size={20} />
        </button>
      </div>

      {/* Sidebar Container */}
      <div
        style={{ height: 'var(--app-height, 100dvh)' }}
        className={`fixed left-0 top-0 z-40 flex min-h-0 transform bg-gray-900 text-white transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Left Nav Icons */}
        <div className="w-16 bg-gray-800 flex flex-col items-center py-10 space-y-4 relative">
          {/* FaTimes to close */}
          <div className="absolute top-4 left-5">
            <button
              onClick={toggleSidebar}
              className="text-white hover:text-gray-400"
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
          </div>
        </div>

        {/* Dynamic Content Area */}
        <div className="flex h-full min-h-0 w-[calc(100vw-4rem)] flex-col overflow-hidden bg-gray-800 sm:w-72">
          {/* Search Input + List */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full mb-4 p-2 rounded bg-gray-700 text-white placeholder-gray-400 focus:outline-none focus:ring focus:ring-blue-400"
            />
            {renderContent()}
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-gray-700 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 flex flex-col items-center">
            <p className="text-sm font-semibold truncate">
              {user?.username || 'Guest'}
            </p>
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
              className="mt-2 text-sm bg-red-500 px-3 py-1 rounded hover:bg-red-600 w-full text-center"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

const IconButton = ({ icon, label, onClick, active }) => (
  <div className="relative group">
    <button
      onClick={onClick}
      className={`text-xl p-2 rounded hover:bg-gray-700 ${
        active ? 'bg-gray-700' : ''
      }`}
    >
      {icon}
    </button>
    <span className="absolute left-full ml-2 top-1/2 transform -translate-y-1/2 scale-0 group-hover:scale-100 transition-transform origin-left whitespace-nowrap bg-black px-2 py-1 text-xs rounded shadow-lg z-50">
      {label}
    </span>
  </div>
);

export default Sidebar;
