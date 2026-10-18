import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Sidebar from './Sidebar';
import Socket from '../Socket';
import { connectAndRegisterUser } from "../Socket";
import { FaUsers, FaVideo } from 'react-icons/fa';
import VideoCall from './VideoCall';

export default function Chat({ user, selectedChat, onSelectChat }) {
  const [msg, setMsg] = useState('');
  const [messages, setMessages] = useState([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isVideoOpen, setIsVideoOpen] = useState(false);

  useEffect(() => {
    connectAndRegisterUser(localStorage.getItem('token'));
    const handleReceive = (data) => {
      if (selectedChatRef.current?.type === 'group') return;
      const conversationUser = String(data.sender) === String(user?._id) ? data.receiver : data.sender;
      if (String(conversationUser) !== String(selectedChatRef.current?._id)) return;
      setMessages((previous) => previous.some((message) => message._id === data._id)
        ? previous
        : [...previous, data]);
    };
    const handleSent = (data) => {
      if (selectedChatRef.current?.type === 'group') return;
      if (String(data.receiver) !== String(selectedChatRef.current?._id)) return;
      setMessages((previous) => previous.some((message) => message._id === data._id)
        ? previous
        : [...previous, data]);
    };
    const handleMessageError = ({ message }) => window.alert(message);
    const handleGroupMessage = (data) => {
      if (selectedChatRef.current?.type !== 'group') return;
      if (String(data.groupId) !== String(selectedChatRef.current?._id)) return;
      setMessages((previous) => previous.some((message) => message._id === data._id)
        ? previous
        : [...previous, data]);
    };
    const handleRemovedFromGroup = ({ groupId }) => {
      if (selectedChatRef.current?.type !== 'group') return;
      if (String(groupId) === String(selectedChatRef.current?._id)) {
        setMessages([]);
        onSelectChat(null);
      }
    };

    Socket.on('receive-message', handleReceive);
    Socket.on('message-sent', handleSent);
    Socket.on('message-error', handleMessageError);
    Socket.on('group-message', handleGroupMessage);
    Socket.on('group-member-removed', handleRemovedFromGroup);

    return () => {
      Socket.off('receive-message', handleReceive);
      Socket.off('message-sent', handleSent);
      Socket.off('message-error', handleMessageError);
      Socket.off('group-message', handleGroupMessage);
      Socket.off('group-member-removed', handleRemovedFromGroup);
    };
  }, [user?._id, onSelectChat]);

  const selectedChatRef = React.useRef(selectedChat);
  selectedChatRef.current = selectedChat;

  useEffect(() => {
    if (!selectedChat?._id) {
      setMessages([]);
      return;
    }
    let active = true;
    const isGroup = selectedChat.type === 'group';
    const joinGroup = () => Socket.emit('join-group', { groupId: selectedChat._id });
    if (isGroup) {
      joinGroup();
      Socket.on('connect', joinGroup);
    }
    const loadMessages = async () => {
      try {
        const { data } = await axios.get(
          `${import.meta.env.VITE_API_URL}/api/${isGroup ? `groups/${selectedChat._id}/messages` : `messages/${selectedChat._id}`}`,
          { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
        );
        if (active) {
          setMessages((current) => {
            const byId = new Map(data.map((message) => [String(message._id), message]));
            current.forEach((message) => byId.set(String(message._id), message));
            return [...byId.values()].sort((left, right) =>
              new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
            );
          });
        }
      } catch (error) {
        if (active) setMessages([]);
        console.error('Failed to load messages:', error);
      }
    };
    loadMessages();
    return () => {
      active = false;
      if (isGroup) Socket.off('connect', joinGroup);
    };
  }, [selectedChat]);

  const sendMessage = (event) => {
    event.preventDefault();
    if (!msg.trim() || !selectedChat?._id || !Socket.connected) return;
    if (selectedChat.type === 'group') {
      Socket.emit('group-message', { groupId: selectedChat._id, content: msg.trim() });
    } else {
      Socket.emit('send-message', { receiver: selectedChat._id, content: msg.trim() });
    }
    setMsg('');
  };

  const toggleSidebar = () => {
    setIsSidebarOpen((prev) => !prev);
  };

  return (
    <div className='bg-gradient-to-br from-[#102229] via-[#142d32] to-[#25423f] h-screen w-screen overflow-hidden flex text-white'>
      <Sidebar isOpen={isSidebarOpen} toggleSidebar={toggleSidebar} onSelectChat={onSelectChat} />


      <div
        className={`flex min-w-0 flex-1 flex-col transition-all duration-300 ease-in-out ${isSidebarOpen ? 'ml-[22rem]' : 'ml-16'}`}
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-white/10 bg-[#102229]/70 px-6 py-4 shadow-lg transition-all duration-300">
          {/* <button onClick={toggleSidebar} className="text-white">
            <FaBars />
          </button> */}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-white">
              {selectedChat?.name || selectedChat?.username || 'Choose a conversation'}
            </h1>
            {selectedChat?.type === 'group' && (
              <p className="mt-0.5 text-xs text-teal-100/65">{selectedChat.members} members · {selectedChat.role}</p>
            )}
          </div>
          <button
            onClick={() => setIsVideoOpen(true)}
            title="Start Video Call"
            disabled={!selectedChat || selectedChat.type === 'group'}
            aria-label="Start video call"
            className="text-white text-xl transition hover:text-teal-200 disabled:opacity-30"
          >
            <FaVideo />
          </button>
        </header>

        {/* Main chat area */}
        <main className="flex-1 overflow-y-auto px-5 py-6 sm:px-8">
          <div className="mx-auto max-w-4xl space-y-3">
            {!selectedChat && <div className="flex h-full min-h-[55vh] flex-col items-center justify-center text-center">
              <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-teal-200/20 bg-teal-100/10 text-teal-100"><FaUsers size={25} /></div>
              <h2 className="text-xl font-semibold">Your conversations</h2>
              <p className="mt-1 text-sm text-white/55">Choose a person or group from the sidebar to start chatting.</p>
            </div>}
            {selectedChat && messages.map((m) => (
              <div
                key={m._id}
                className={`flex ${String(m.sender) === String(user?._id) ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[min(82%,34rem)] rounded-2xl px-4 py-2.5 text-sm shadow ${String(m.sender) === String(user?._id)
                    ? 'rounded-br-sm bg-teal-600 text-white'
                    : 'rounded-bl-sm border border-white/10 bg-[#f3f6f4] text-gray-900'
                    }`}
                >
                  {(selectedChat.type === 'group' || String(m.sender) !== String(user?._id)) && <p className={`mb-0.5 text-xs font-semibold ${String(m.sender) === String(user?._id) ? 'text-teal-100' : 'text-teal-800'}`}>
                    {String(m.sender) === String(user?._id) ? 'You' : m.senderName || selectedChat.username}
                  </p>}
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  <span className={`mt-1 block text-right text-[10px] ${String(m.sender) === String(user?._id) ? 'text-teal-100/70' : 'text-gray-500'}`}>
                    {new Date(m.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-white/10 bg-[#102229]/70 px-5 py-4 sm:px-8">
          <form onSubmit={sendMessage} className="mx-auto flex max-w-4xl items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-2">
            <input
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-white/45"
              placeholder={selectedChat ? `Message ${selectedChat.name || selectedChat.username}...` : 'Choose a conversation first'}
              disabled={!selectedChat}
            />
            <button
              className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-[#062a27] transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-40"
              type="submit"
              disabled={!selectedChat || !msg.trim()}
            >
              Send
            </button>
          </form>
        </footer>

        {/* Video Call Modal */}
        <VideoCall
          to={selectedChat?.type === 'group' ? null : selectedChat?._id}
          isOpen={isVideoOpen}
          onClose={() => setIsVideoOpen(false)}
        />
      </div>
    </div>
  );
}
