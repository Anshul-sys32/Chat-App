import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Sidebar from './Sidebar';
import Socket from '../Socket';
import { connectAndRegisterUser } from "../Socket";
import { FaPhone, FaTrashAlt, FaUsers, FaVideo } from 'react-icons/fa';
import VideoCall from './VideoCall';
import AdminPanel from './AdminPanel';

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";

export default function Chat({ user, selectedChat, onSelectChat }) {
  const [msg, setMsg] = useState('');
  const [messages, setMessages] = useState([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isVideoOpen, setIsVideoOpen] = useState(false);
  const [socketConnected, setSocketConnected] = useState(Socket.connected);
  const [callType, setCallType] = useState('video');
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [messagesAttempt, setMessagesAttempt] = useState(0);
  const messagesRequestId = React.useRef(0);

  useEffect(() => {
    const updateAppHeight = () => {
      const height = window.visualViewport?.height || window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${height}px`);
    };
    updateAppHeight();
    window.addEventListener('resize', updateAppHeight);
    window.visualViewport?.addEventListener('resize', updateAppHeight);
    return () => {
      window.removeEventListener('resize', updateAppHeight);
      window.visualViewport?.removeEventListener('resize', updateAppHeight);
      document.documentElement.style.removeProperty('--app-height');
    };
  }, []);

  useEffect(() => {
    connectAndRegisterUser(localStorage.getItem('token'));
    const handleSocketConnect = () => setSocketConnected(true);
    const handleSocketDisconnect = () => setSocketConnected(false);
    Socket.on('connect', handleSocketConnect);
    Socket.on('disconnect', handleSocketDisconnect);
    setSocketConnected(Socket.connected);
    const reconnectOnResume = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        connectAndRegisterUser(localStorage.getItem('token'));
      }
    };
    window.addEventListener('online', reconnectOnResume);
    window.addEventListener('pageshow', reconnectOnResume);
    document.addEventListener('visibilitychange', reconnectOnResume);
    const handleReceive = (data) => {
      const selectedId = String(selectedChatRef.current?._id);
      const currentUserId = String(user?._id);
      const isConversationMessage = (
        String(data.sender) === currentUserId && String(data.receiver) === selectedId
      ) || (
        String(data.sender) === selectedId && String(data.receiver) === currentUserId
      );
      if (selectedChatRef.current?.type === 'group' || !isConversationMessage) return;
      setMessages((previous) => previous.some((message) => message._id === data._id)
        ? previous
        : [...previous, data]);
    };
    const handleSent = (data) => {
      if (selectedChatRef.current?.type === 'group'
        || String(data.sender) !== String(user?._id)
        || String(data.receiver) !== String(selectedChatRef.current?._id)) return;
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
    const handleMessageUpdated = (data) => {
      if (data.groupId) {
        if (selectedChatRef.current?.type !== 'group'
          || String(data.groupId) !== String(selectedChatRef.current?._id)) return;
      } else {
        const selectedId = String(selectedChatRef.current?._id);
        const currentUserId = String(user?._id);
        const isConversationMessage = (
          String(data.sender) === currentUserId && String(data.receiver) === selectedId
        ) || (
          String(data.sender) === selectedId && String(data.receiver) === currentUserId
        );
        if (selectedChatRef.current?.type === 'group' || !isConversationMessage) return;
      }
      setMessages((previous) => previous.map((message) =>
        String(message._id) === String(data._id) ? { ...message, ...data } : message
      ));
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
    Socket.on('message-updated', handleMessageUpdated);
    Socket.on('group-message-updated', handleMessageUpdated);
    Socket.on('group-member-removed', handleRemovedFromGroup);

    return () => {
      Socket.off('receive-message', handleReceive);
      Socket.off('message-sent', handleSent);
      Socket.off('message-error', handleMessageError);
      Socket.off('group-message', handleGroupMessage);
      Socket.off('message-updated', handleMessageUpdated);
      Socket.off('group-message-updated', handleMessageUpdated);
      Socket.off('group-member-removed', handleRemovedFromGroup);
      Socket.off('connect', handleSocketConnect);
      Socket.off('disconnect', handleSocketDisconnect);
      window.removeEventListener('online', reconnectOnResume);
      window.removeEventListener('pageshow', reconnectOnResume);
      document.removeEventListener('visibilitychange', reconnectOnResume);
    };
  }, [user?._id, onSelectChat]);

  const selectedChatRef = React.useRef(selectedChat);
  selectedChatRef.current = selectedChat;

  useEffect(() => {
    if (!selectedChat?._id) {
      messagesRequestId.current += 1;
      setMessages([]);
      setMessagesError('');
      setMessagesLoading(false);
      return;
    }
    let active = true;
    const isGroup = selectedChat.type === 'group';
    const chatId = String(selectedChat._id);
    const currentUserId = String(user?._id);
    const requestId = ++messagesRequestId.current;
    setMessages([]);
    setMessagesError('');
    setMessagesLoading(true);
    const joinGroup = () => {
      if (Socket.connected) Socket.emit('join-group', { groupId: selectedChat._id });
    };
    if (isGroup) {
      joinGroup();
      Socket.on('connect', joinGroup);
    }
    const loadMessages = async () => {
      setMessagesError('');
      try {
        const { data } = await axios.get(
          `${API_URL}/api/${isGroup ? `groups/${selectedChat._id}/messages` : `messages/${selectedChat._id}`}`,
          { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
        );
        if (!Array.isArray(data)) throw new Error('The server returned an invalid message history.');
        if (requestId !== messagesRequestId.current) return;
        if (active) {
          setMessages((current) => {
            const messagePrefix = isGroup ? `group:${chatId}:` : `direct:${currentUserId}:${chatId}:`;
            const byId = new Map(data.map((message) => [`${messagePrefix}${message._id}`, message]));
            current.forEach((message) => {
              const belongsToConversation = isGroup
                ? String(message.groupId) === chatId
                : (
                  String(message.sender) === currentUserId && String(message.receiver) === chatId
                ) || (
                  String(message.sender) === chatId && String(message.receiver) === currentUserId
                );
              if (belongsToConversation) {
                byId.set(`${messagePrefix}${message._id}`, message);
              }
            });
            return [...byId.values()].sort((left, right) =>
              new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
            );
          });
        }
      } catch (error) {
        if (active && requestId === messagesRequestId.current) setMessagesError(
          error.response?.data?.message || error.message || 'Could not load this conversation.'
        );
        console.error('Failed to load messages:', error);
      } finally {
        if (active && requestId === messagesRequestId.current) setMessagesLoading(false);
      }
    };
    loadMessages();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        joinGroup();
        loadMessages();
      }
    };
    window.addEventListener('pageshow', refreshWhenVisible);
    window.addEventListener('online', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      active = false;
      if (messagesRequestId.current === requestId) messagesRequestId.current += 1;
      if (isGroup) Socket.off('connect', joinGroup);
      window.removeEventListener('pageshow', refreshWhenVisible);
      window.removeEventListener('online', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [selectedChat?._id, selectedChat?.type, messagesAttempt, user?._id]);

  const sendMessage = (event) => {
    event.preventDefault();
    if (!msg.trim() || !selectedChat?._id) return;
    if (!Socket.connected) {
      setSocketConnected(false);
      return;
    }
    if (selectedChat.type === 'group') {
      Socket.emit('group-message', { groupId: selectedChat._id, content: msg.trim() });
    } else {
      Socket.emit('send-message', { receiver: selectedChat._id, content: msg.trim() });
    }
    setMsg('');
  };

  const deleteMessage = async (message) => {
    try {
      const endpoint = selectedChat.type === 'group'
        ? `/api/groups/${selectedChat._id}/messages/${message._id}`
        : `/api/messages/${message._id}`;
      const { data } = await axios.delete(`${API_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        withCredentials: true,
      });
      setMessages((previous) => previous.map((candidate) =>
        String(candidate._id) === String(data._id) ? { ...candidate, ...data } : candidate
      ));
    } catch (error) {
      window.alert(error.response?.data?.message || 'Could not delete this message.');
    }
  };

  const toggleSidebar = () => {
    setIsSidebarOpen((prev) => !prev);
  };

  return (
    <div style={{ height: 'var(--app-height, 100dvh)' }} className='flex h-screen w-screen overflow-hidden bg-gradient-to-br from-[#102229] via-[#142d32] to-[#25423f] text-white'>
      <Sidebar
        isOpen={isSidebarOpen}
        toggleSidebar={toggleSidebar}
        onSelectChat={onSelectChat}
        onOpenAdmin={() => setIsAdminOpen(true)}
      />


      <div
        className={`ml-0 flex min-h-0 min-w-0 flex-1 flex-col transition-all duration-300 ease-in-out sm:ml-16 ${isSidebarOpen ? 'sm:ml-[22rem]' : ''}`}
      >
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#102229]/70 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-lg sm:px-6 sm:py-4">
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
          <div className="flex items-center gap-4">
            <button
              onClick={() => { setCallType('audio'); setIsVideoOpen(true); }}
              title="Start Audio Call"
              disabled={!selectedChat || selectedChat.type === 'group'}
              aria-label="Start audio call"
              className="text-white text-xl transition hover:text-teal-200 disabled:opacity-30"
            >
              <FaPhone />
            </button>
            <button
              onClick={() => { setCallType('video'); setIsVideoOpen(true); }}
              title="Start Video Call"
              disabled={!selectedChat || selectedChat.type === 'group'}
              aria-label="Start video call"
              className="text-white text-xl transition hover:text-teal-200 disabled:opacity-30"
            >
              <FaVideo />
            </button>
          </div>
        </header>

        {/* Main chat area */}
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-8 sm:py-6">
          <div className="mx-auto max-w-4xl space-y-3">
            {!selectedChat && <div className="flex h-full min-h-[55vh] flex-col items-center justify-center text-center">
              <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-teal-200/20 bg-teal-100/10 text-teal-100"><FaUsers size={25} /></div>
              <h2 className="text-xl font-semibold">Your conversations</h2>
              <p className="mt-1 text-sm text-white/55">Choose a person or group from the sidebar to start chatting.</p>
            </div>}
            {selectedChat && messagesLoading && messages.length === 0 && (
              <p role="status" className="py-8 text-center text-sm text-white/60">Loading conversation…</p>
            )}
            {selectedChat && messagesError && (
              <div role="alert" className="my-4 rounded-lg border border-rose-200/20 bg-rose-950/50 p-4 text-center text-sm text-rose-100">
                <p>{messagesError}</p>
                <button
                  type="button"
                  onClick={() => setMessagesAttempt((attempt) => attempt + 1)}
                  className="mt-3 rounded-md border border-white/20 px-3 py-1.5 font-medium hover:bg-white/10"
                >
                  Retry loading
                </button>
              </div>
            )}
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
                  <p className={`whitespace-pre-wrap break-words ${m.isDeleted ? 'italic opacity-75' : ''}`}>{m.content}</p>
                  <span className={`mt-1 block text-right text-[10px] ${String(m.sender) === String(user?._id) ? 'text-teal-100/70' : 'text-gray-500'}`}>
                    {new Date(m.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {String(m.sender) === String(user?._id) && !m.isDeleted && (
                    <button
                      type="button"
                      onClick={() => deleteMessage(m)}
                      title="Delete message"
                      aria-label="Delete message"
                      className="mt-1 flex items-center gap-1 text-[10px] text-white/60 transition hover:text-rose-200"
                    >
                      <FaTrashAlt size={9} /> Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </main>

        {/* Footer */}
        <footer className="shrink-0 border-t border-white/10 bg-[#102229]/90 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl sm:px-8 sm:py-4">
          {selectedChat && !socketConnected && (
            <p role="status" className="mx-auto mb-2 max-w-4xl text-xs text-amber-200">
              Reconnecting to chat… Messages will send when the connection is restored.
            </p>
          )}
          <form onSubmit={sendMessage} className="mx-auto flex max-w-4xl items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.07] p-2 shadow-lg shadow-black/10">
            <input
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              className="min-w-0 flex-1 bg-transparent px-3 py-3 text-base text-white outline-none placeholder:text-white/45 sm:text-sm"
              placeholder={selectedChat ? `Message ${selectedChat.name || selectedChat.username}...` : 'Choose a conversation first'}
              disabled={!selectedChat}
            />
            <button
              className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-[#062a27] transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-40"
              type="submit"
              disabled={!selectedChat || !msg.trim() || !socketConnected}
            >
              Send
            </button>
          </form>
        </footer>

        {/* Video Call Modal */}
        {isAdminOpen && user?.role === 'admin' && (
          <div className="fixed inset-0 z-30 overflow-y-auto bg-[#102229]">
            <AdminPanel user={user} onBack={() => setIsAdminOpen(false)} />
          </div>
        )}
        <VideoCall
          to={selectedChat?.type === 'group' ? null : selectedChat?._id}
          peerName={selectedChat?.name || selectedChat?.username}
          callType={callType}
          isOpen={isVideoOpen}
          onClose={() => setIsVideoOpen(false)}
        />
      </div>
    </div>
  );
}
