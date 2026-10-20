import React, { useState, useEffect, useLayoutEffect } from 'react';
import axios from 'axios';
import Sidebar from './Sidebar';
import Socket from '../Socket';
import { connectAndRegisterUser } from "../Socket";
import { FaPaperclip, FaPhone, FaTrashAlt, FaUsers, FaVideo } from 'react-icons/fa';
import VideoCall from './VideoCall';
import AdminPanel from './AdminPanel';
import NotificationCenter from './NotificationCenter';
import Avatar from './Avatar';

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";
const MAX_FILES_PER_MESSAGE = 5;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ACCEPTED_FILE_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
  'application/pdf',
].join(',');

const getAttachments = (message) => {
  if (message.isDeleted) return [];
  let attachments = message.attachments;
  if (typeof attachments === 'string') {
    try {
      attachments = JSON.parse(attachments);
    } catch {
      return [];
    }
  }
  return Array.isArray(attachments)
    ? attachments.filter((attachment) => attachment && typeof attachment.url === 'string'
      && attachment.url.startsWith('/uploads/') && typeof attachment.mimeType === 'string')
    : [];
};

const formatFileSize = (size) => {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export default function Chat({ user, selectedChat, onSelectChat, onUserUpdated, theme, onToggleTheme }) {
  const [msg, setMsg] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = React.useRef(null);
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
  const messagesContainerRef = React.useRef(null);
  const scrollToLatestOnLoad = React.useRef(false);
  const pendingScrollAdjustment = React.useRef(null);
  const loadingOlderRef = React.useRef(false);
  const [messagesHasMore, setMessagesHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const footerRef = React.useRef(null);
  const [footerHeight, setFooterHeight] = useState(0);

  useEffect(() => {
    setIsSidebarOpen(false);
    setSelectedFiles([]);
  }, [selectedChat?._id]);

  useEffect(() => {
    if (!selectedChat?._id || selectedChat.type === 'group') return;
    axios.post(`${API_URL}/api/messages/${selectedChat._id}/read`, {}, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      withCredentials: true,
    }).catch((error) => {
      console.error('Failed to mark messages as read:', error);
    });
  }, [selectedChat?._id, selectedChat?.type]);

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
    const footer = footerRef.current;
    if (!footer) return undefined;
    const measureFooter = () => setFooterHeight(footer.getBoundingClientRect().height);
    measureFooter();
    const observer = new ResizeObserver(measureFooter);
    observer.observe(footer);
    return () => observer.disconnect();
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
    const reconnectOnSessionChange = (event) => {
      if (event.key === 'token') connectAndRegisterUser(localStorage.getItem('token'));
    };
    window.addEventListener('online', reconnectOnResume);
    window.addEventListener('pageshow', reconnectOnResume);
    window.addEventListener('storage', reconnectOnSessionChange);
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
    const handleProfilePicture = ({ userId, profilePicture }) => {
      if (selectedChatRef.current?.type === 'group'
        || String(selectedChatRef.current?._id) !== String(userId)) return;
      onSelectChat({ ...selectedChatRef.current, profilePicture });
    };
    const handleGroupPicture = ({ groupId, avatarUrl }) => {
      if (selectedChatRef.current?.type !== 'group'
        || String(selectedChatRef.current?._id) !== String(groupId)) return;
      onSelectChat({ ...selectedChatRef.current, avatarUrl });
    };

    Socket.on('receive-message', handleReceive);
    Socket.on('message-sent', handleSent);
    Socket.on('message-error', handleMessageError);
    Socket.on('group-message', handleGroupMessage);
    Socket.on('message-updated', handleMessageUpdated);
    Socket.on('group-message-updated', handleMessageUpdated);
    Socket.on('group-member-removed', handleRemovedFromGroup);
    Socket.on('profile-picture-updated', handleProfilePicture);
    Socket.on('group-picture-updated', handleGroupPicture);

    return () => {
      Socket.off('receive-message', handleReceive);
      Socket.off('message-sent', handleSent);
      Socket.off('message-error', handleMessageError);
      Socket.off('group-message', handleGroupMessage);
      Socket.off('message-updated', handleMessageUpdated);
      Socket.off('group-message-updated', handleMessageUpdated);
      Socket.off('group-member-removed', handleRemovedFromGroup);
      Socket.off('profile-picture-updated', handleProfilePicture);
      Socket.off('group-picture-updated', handleGroupPicture);
      Socket.off('connect', handleSocketConnect);
      Socket.off('disconnect', handleSocketDisconnect);
      window.removeEventListener('online', reconnectOnResume);
      window.removeEventListener('pageshow', reconnectOnResume);
      window.removeEventListener('storage', reconnectOnSessionChange);
      document.removeEventListener('visibilitychange', reconnectOnResume);
    };
  }, [user?._id, onSelectChat]);

  const selectedChatRef = React.useRef(selectedChat);
  selectedChatRef.current = selectedChat;

  useEffect(() => {
    if (!selectedChat?._id) {
      messagesRequestId.current += 1;
      setMessages([]);
      setMessagesHasMore(false);
      setMessagesError('');
      setMessagesLoading(false);
      scrollToLatestOnLoad.current = false;
      return;
    }
    let active = true;
    const isGroup = selectedChat.type === 'group';
    const chatId = String(selectedChat._id);
    const currentUserId = String(user?._id);
    const requestId = ++messagesRequestId.current;
    setMessages([]);
    setMessagesHasMore(false);
    setMessagesError('');
    setMessagesLoading(true);
    scrollToLatestOnLoad.current = true;
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
        if (!Array.isArray(data.messages) || typeof data.hasMore !== 'boolean') {
          throw new Error('The server returned an invalid message history.');
        }
        if (requestId !== messagesRequestId.current) return;
        setMessagesHasMore(data.hasMore);
        if (active) {
          setMessages((current) => {
            const messagePrefix = isGroup ? `group:${chatId}:` : `direct:${currentUserId}:${chatId}:`;
            const byId = new Map(data.messages.map((message) => [`${messagePrefix}${message._id}`, message]));
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

  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (pendingScrollAdjustment.current) {
      const { height, top } = pendingScrollAdjustment.current;
      container.scrollTop = container.scrollHeight - height + top;
      pendingScrollAdjustment.current = null;
      return;
    }
    if (selectedChat && !messagesLoading && scrollToLatestOnLoad.current) {
      container.scrollTop = container.scrollHeight;
      scrollToLatestOnLoad.current = false;
    }
  }, [messages, messagesLoading, selectedChat]);

  const loadOlderMessages = async () => {
    const chat = selectedChatRef.current;
    const oldestMessage = messages[0];
    if (!chat?._id || !oldestMessage || !messagesHasMore || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const chatId = String(chat._id);
    const isGroup = chat.type === 'group';
    const container = messagesContainerRef.current;
    const previousHeight = container?.scrollHeight || 0;
    const previousTop = container?.scrollTop || 0;
    try {
      const { data } = await axios.get(
        `${API_URL}/api/${isGroup ? `groups/${chat._id}/messages` : `messages/${chat._id}`}`,
        {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
          params: { before: String(oldestMessage._id), limit: 50 },
        }
      );
      if (!Array.isArray(data.messages) || typeof data.hasMore !== 'boolean') {
        throw new Error('The server returned an invalid message history.');
      }
      const currentChat = selectedChatRef.current;
      if (!currentChat || String(currentChat._id) !== chatId || currentChat.type !== chat.type) return;
      pendingScrollAdjustment.current = { height: previousHeight, top: previousTop };
      setMessages((current) => {
        const existingIds = new Set(current.map((message) => String(message._id)));
        const olderMessages = data.messages.filter((message) => !existingIds.has(String(message._id)));
        return [...olderMessages, ...current];
      });
      setMessagesHasMore(data.hasMore);
    } catch (error) {
      setMessagesError(error.response?.data?.message || error.message || 'Could not load older messages.');
      console.error('Failed to load older messages:', error);
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  };

  const handleMessagesScroll = (event) => {
    if (event.currentTarget.scrollTop <= 80) loadOlderMessages();
  };

  const selectFiles = (event) => {
    const incomingFiles = Array.from(event.target.files || []);
    event.target.value = '';
    if (selectedFiles.length + incomingFiles.length > MAX_FILES_PER_MESSAGE) {
      window.alert(`You can send up to ${MAX_FILES_PER_MESSAGE} files per message.`);
      return;
    }
    const oversizedFile = incomingFiles.find((file) => file.size > MAX_FILE_SIZE);
    if (oversizedFile) {
      window.alert(`${oversizedFile.name} is larger than the 50 MB limit.`);
      return;
    }
    setSelectedFiles((current) => [...current, ...incomingFiles]);
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    if ((!msg.trim() && !selectedFiles.length) || !selectedChat?._id || isSending) return;
    if (!Socket.connected) {
      setSocketConnected(false);
      return;
    }
    const chat = selectedChat;
    setIsSending(true);
    try {
      let attachments = [];
      if (selectedFiles.length) {
        const formData = new FormData();
        formData.append('type', chat.type === 'group' ? 'group' : 'direct');
        formData.append('targetId', chat._id);
        selectedFiles.forEach((file) => formData.append('files', file));
        const { data } = await axios.post(`${API_URL}/api/uploads`, formData, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
          withCredentials: true,
        });
        attachments = data;
      }
      const payload = {
        content: msg.trim(),
        ...(attachments.length ? { attachments } : {}),
      };
      if (chat.type === 'group') {
        Socket.emit('group-message', { ...payload, groupId: chat._id });
      } else {
        Socket.emit('send-message', { ...payload, receiver: chat._id });
      }
      setMsg('');
      setSelectedFiles([]);
    } catch (error) {
      window.alert(error.response?.data?.message || 'Could not upload the selected files.');
    } finally {
      setIsSending(false);
    }
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
  const closeSidebar = () => setIsSidebarOpen(false);

  return (
    <div style={{ height: 'var(--app-height, 100dvh)' }} className="theme-page flex h-screen w-screen overflow-hidden">
      <Sidebar
        isOpen={isSidebarOpen}
        toggleSidebar={toggleSidebar}
        onCloseSidebar={closeSidebar}
        onSelectChat={onSelectChat}
        onOpenAdmin={() => setIsAdminOpen(true)}
        user={user}
        onUserUpdated={onUserUpdated}
        theme={theme}
        onToggleTheme={onToggleTheme}
        selectedChat={selectedChat}
      />


      <div
        className={`ml-0 flex min-h-0 min-w-0 flex-1 flex-col transition-all duration-300 ease-in-out sm:ml-16 ${isSidebarOpen ? 'sm:ml-[22rem]' : ''}`}
      >
        {/* Header */}
        <header className="theme-header relative z-30 flex w-full shrink-0 items-center justify-between gap-2 rounded-b-2xl border px-3 py-3 pl-16 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-lg sm:px-6 sm:py-4">
          {/* <button onClick={toggleSidebar} className="text-white">
            <FaBars />
          </button> */}
          {selectedChat && (
            <Avatar
              src={selectedChat.type === 'group'
                ? selectedChat.avatarUrl
                : selectedChat.profilePicture || selectedChat.googlePicture}
              name={selectedChat.name || selectedChat.username}
              group={selectedChat.type === 'group'}
              className="h-10 w-10 text-sm"
            />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="theme-text truncate text-lg font-semibold">
              {selectedChat?.name || selectedChat?.username || 'Choose a conversation'}
            </h1>
            {selectedChat?.type === 'group' && (
              <p className="theme-muted mt-0.5 text-xs">{selectedChat.members} members · {selectedChat.role}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-end gap-1 sm:gap-4">
            <NotificationCenter />
            <button
              onClick={() => { setCallType('audio'); setIsVideoOpen(true); }}
              title="Start Audio Call"
              disabled={!selectedChat || selectedChat.type === 'group'}
              aria-label="Start audio call"
              className="chat-action theme-text grid h-10 w-10 place-items-center rounded-xl border transition hover:text-teal-500 disabled:opacity-30"
            >
              <FaPhone />
            </button>
            <button
              onClick={() => { setCallType('video'); setIsVideoOpen(true); }}
              title="Start Video Call"
              disabled={!selectedChat || selectedChat.type === 'group'}
              aria-label="Start video call"
              className="chat-action theme-text grid h-10 w-10 place-items-center rounded-xl border transition hover:text-teal-500 disabled:opacity-30"
            >
              <FaVideo />
            </button>
          </div>
        </header>

        {/* Main chat area */}
        <main
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          style={{ paddingBottom: `${footerHeight + 16}px` }}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-8 sm:py-6"
        >
          <div className="chat-content-panel glass-panel mx-auto flex min-h-full w-full max-w-5xl flex-col space-y-3 rounded-2xl p-3 sm:p-5">
            {!selectedChat && <div className="flex h-full min-h-[55vh] flex-col items-center justify-center text-center">
              <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-teal-200/20 bg-teal-100/10 text-teal-100"><FaUsers size={25} /></div>
              <h2 className="text-xl font-semibold">Your conversations</h2>
              <p className="theme-muted mt-1 text-sm">Choose a person or group from the sidebar to start chatting.</p>
            </div>}
            {selectedChat && messagesLoading && messages.length === 0 && (
              <p role="status" className="theme-muted py-8 text-center text-sm">Loading conversation…</p>
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
            {selectedChat && loadingOlder && (
              <p role="status" className="theme-muted py-2 text-center text-xs">Loading older messages…</p>
            )}
            {selectedChat && messages.map((m) => (
              <div
                key={m._id}
                className={`flex ${String(m.sender) === String(user?._id) ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[min(82%,34rem)] rounded-2xl px-4 py-2.5 text-sm shadow ${String(m.sender) === String(user?._id)
                    ? 'chat-bubble-own rounded-br-sm'
                    : 'chat-bubble-peer rounded-bl-sm'
                    }`}
                >
                  {(selectedChat.type === 'group' || String(m.sender) !== String(user?._id)) && <p className={`mb-0.5 text-xs font-semibold ${String(m.sender) === String(user?._id) ? 'text-teal-100' : 'text-teal-800'}`}>
                    {String(m.sender) === String(user?._id) ? 'You' : m.senderName || selectedChat.username}
                  </p>}
                  {m.content && (
                    <p className={`whitespace-pre-wrap break-words ${m.isDeleted ? 'italic opacity-75' : ''}`}>{m.content}</p>
                  )}
                  {!m.isDeleted && getAttachments(m).map((attachment) => (
                    <div key={attachment.url} className="mt-2 max-w-full">
                      {attachment.mimeType.startsWith('image/') ? (
                        <a href={`${API_URL}${attachment.url}`} target="_blank" rel="noreferrer">
                          <img
                            src={`${API_URL}${attachment.url}`}
                            alt={attachment.name}
                            className="max-h-72 max-w-full rounded-lg object-contain"
                          />
                        </a>
                      ) : attachment.mimeType.startsWith('video/') ? (
                        <video controls preload="metadata" className="max-h-72 max-w-full rounded-lg">
                          <source src={`${API_URL}${attachment.url}`} type={attachment.mimeType} />
                          Your browser cannot play this video.
                        </video>
                      ) : attachment.mimeType.startsWith('audio/') ? (
                        <audio controls preload="metadata" className="max-w-full">
                          <source src={`${API_URL}${attachment.url}`} type={attachment.mimeType} />
                          Your browser cannot play this audio.
                        </audio>
                      ) : (
                        <a
                          href={`${API_URL}${attachment.url}`}
                          target="_blank"
                          rel="noreferrer"
                          className="block break-all underline"
                        >
                          {attachment.name} ({formatFileSize(attachment.size)})
                        </a>
                      )}
                    </div>
                  ))}
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
        <footer
          ref={footerRef}
          className="theme-footer fixed inset-x-0 bottom-0 z-30 box-border w-full min-w-0 rounded-t-2xl border px-[max(0.75rem,env(safe-area-inset-left))] pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl sm:px-8 sm:py-4"
        >
          {selectedChat && !socketConnected && (
            <p role="status" className="mx-auto mb-2 max-w-4xl text-xs text-amber-200">
              Reconnecting to chat… Messages will send when the connection is restored.
            </p>
          )}
          <form onSubmit={sendMessage} className="theme-composer flex w-full min-w-0 items-center gap-2 rounded-2xl border p-2 shadow-lg shadow-black/10">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              multiple
              onChange={selectFiles}
              className="sr-only"
              aria-label="Choose attachments"
            />
            <button
              type="button"
              title="Attach images, audio, video, or PDF files (up to 50 MB each)"
              aria-label="Attach files"
              onClick={() => fileInputRef.current?.click()}
              disabled={!selectedChat || isSending}
              className="chat-action theme-text inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm transition hover:text-teal-500 disabled:opacity-50"
            >
              <FaPaperclip />
              <span>Attach</span>
            </button>
            <input
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              className="theme-composer-input min-w-0 flex-1 bg-transparent px-3 py-3 text-base outline-none placeholder:opacity-60 sm:text-sm"
              placeholder={selectedChat ? `Message ${selectedChat.name || selectedChat.username}...` : 'Choose a conversation first'}
              disabled={!selectedChat || isSending}
            />
            <button
              className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-[#062a27] transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-40"
              type="submit"
              disabled={!selectedChat || (!msg.trim() && !selectedFiles.length) || !socketConnected || isSending}
            >
              {isSending ? 'Sending…' : 'Send'}
            </button>
          </form>
          {selectedFiles.length > 0 && (
            <ul className="mx-auto mt-2 flex max-w-4xl flex-wrap gap-2" aria-label="Selected attachments">
              {selectedFiles.map((file, index) => (
                <li key={`${file.name}-${file.lastModified}-${index}`} className="theme-muted flex items-center gap-2 rounded-lg border border-white/10 px-2 py-1 text-xs">
                  <span className="max-w-48 truncate">{file.name} · {formatFileSize(file.size)}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    disabled={isSending}
                    aria-label={`Remove ${file.name}`}
                    className="font-semibold hover:text-rose-400 disabled:opacity-50"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </footer>

        {/* Video Call Modal */}
        {isAdminOpen && user?.role === 'admin' && (
          <div className="theme-page fixed inset-0 z-30 overflow-y-auto">
            <AdminPanel user={user} onBack={() => setIsAdminOpen(false)} onUserUpdated={onUserUpdated} />
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
