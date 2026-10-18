import React, { useState } from 'react';
import {
  FaUserFriends,
  FaUsers,
  FaLayerGroup,
  FaTimes,
  FaBars
} from 'react-icons/fa';
import UserList from './UserList';
import GroupList from './GroupList';

const Sidebar = ({ isOpen, toggleSidebar, onSelectChat }) => {
  const [activeTab, setActiveTab] = useState('global');
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
      case 'global':
        return <UserList type="global" search={search} onStartChat={onSelectChat} />;
      case 'local':
        return <UserList type="local" search={search} onStartChat={onSelectChat} />;
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
        className={`fixed top-0 left-0 h-full z-40 transform transition-transform duration-300 ease-in-out flex bg-gray-900 text-white ${
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
              icon={<FaUserFriends />}
              label="Global Users"
              onClick={() => setActiveTab('global')}
              active={activeTab === 'global'}
            />
            <IconButton
              icon={<FaUsers />}
              label="Local Users"
              onClick={() => setActiveTab('local')}
              active={activeTab === 'local'}
            />
            <IconButton
              icon={<FaLayerGroup />}
              label="Groups"
              onClick={() => setActiveTab('groups')}
              active={activeTab === 'groups'}
            />
          </div>
        </div>

        {/* Dynamic Content Area */}
        <div className="w-72 bg-gray-800 flex flex-col justify-between">
          {/* Search Input + List */}
          <div className="p-4 overflow-y-auto">
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
          <div className="p-4 border-t border-gray-700 flex flex-col items-center">
            <p className="text-sm font-semibold truncate">
              {user?.username || 'Guest'}
            </p>
            <button
              onClick={() => {
                localStorage.removeItem('user');
                localStorage.removeItem('token');
                localStorage.removeItem('localUsers');
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
