import React, { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import axios from 'axios';
import Sidebar from './Sidebar';
import Socket from '../Socket';
import { connectAndRegisterUser } from "../Socket";
import { FaCopy, FaEllipsisV, FaPaperclip, FaPhone, FaReply, FaSmile, FaStar, FaTimes, FaUsers, FaVideo } from 'react-icons/fa';
import VideoCall from './VideoCall';
import AdminPanel from './AdminPanel';
import NotificationCenter from './NotificationCenter';
import Avatar from './Avatar';
import { loadStickerCatalog, releaseStickerSources } from '../stickerCache';

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
  const [replyTo, setReplyTo] = useState(null);
  const [openMessageMenu, setOpenMessageMenu] = useState(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [openBulkMenu, setOpenBulkMenu] = useState(false);
  const [pendingForward, setPendingForward] = useState(null);
  const [stickers, setStickers] = useState([]);
  const [stickerCategories, setStickerCategories] = useState(['General']);
  const [stickerSources, setStickerSources] = useState({});
  const stickerSourcesRef = React.useRef({});
  const [showStickers, setShowStickers] = useState(false);
  const [showAddSticker, setShowAddSticker] = useState(false);
  const [stickerName, setStickerName] = useState('');
  const [stickerUploadCategory, setStickerUploadCategory] = useState('General');
  const [newStickerCategory, setNewStickerCategory] = useState('');
  const [stickerFile, setStickerFile] = useState(null);
  const [stickerError, setStickerError] = useState('');
  const [stickerCategory, setStickerCategory] = useState('all');
  const [favoriteStickerIds, setFavoriteStickerIds] = useState([]);
  const [recentStickerIds, setRecentStickerIds] = useState([]);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  const replyDrag = React.useRef(null);
  const [replySwipe, setReplySwipe] = useState({ messageId: null, offset: 0, dragging: false });

  const applyStickerCatalog = useCallback((catalog) => {
    setStickers(catalog.stickers);
    setStickerCategories(catalog.categories);
    Object.entries(stickerSourcesRef.current).forEach(([source, objectUrl]) => {
      if (catalog.sources[source] !== objectUrl) URL.revokeObjectURL(objectUrl);
    });
    stickerSourcesRef.current = catalog.sources;
    setStickerSources(catalog.sources);
  }, []);

  const refreshStickerCatalog = useCallback(async () => {
    const catalog = await loadStickerCatalog(API_URL, localStorage.getItem('token'), stickerSourcesRef.current);
    applyStickerCatalog(catalog);
  }, [applyStickerCatalog]);

  useEffect(() => {
    setIsSidebarOpen(false);
    setSelectedFiles([]);
    setReplyTo(null);
    setOpenMessageMenu(null);
    setSelectedMessageIds([]);
    setIsSelectionMode(false);
    setOpenBulkMenu(false);
  }, [selectedChat?._id]);

  useEffect(() => {
    if (!pendingForward || !selectedChat?._id || String(selectedChat._id) === String(pendingForward.sourceChatId)) return;
    setMsg(pendingForward.content || '');
    setPendingForward(null);
    setIsSidebarOpen(false);
  }, [selectedChat?._id, pendingForward]);

  useEffect(() => {
    let active = true;
    loadStickerCatalog(API_URL, localStorage.getItem('token'))
      .then((catalog) => {
        if (active) applyStickerCatalog(catalog);
        else releaseStickerSources(catalog.sources);
      })
      .catch((error) => console.error('Could not load stickers:', error));
    return () => {
      active = false;
      releaseStickerSources(stickerSourcesRef.current);
      stickerSourcesRef.current = {};
    };
  }, [user?._id, applyStickerCatalog]);

  useEffect(() => {
    const handleStickerCatalogUpdate = () => {
      refreshStickerCatalog().catch((error) => console.error('Could not refresh sticker catalog:', error));
    };
    Socket.on('sticker-catalog-updated', handleStickerCatalogUpdate);
    return () => Socket.off('sticker-catalog-updated', handleStickerCatalogUpdate);
  }, [user?._id, refreshStickerCatalog]);

  useEffect(() => () => {
    releaseStickerSources(stickerSourcesRef.current);
    stickerSourcesRef.current = {};
  }, []);

  useEffect(() => {
    const key = `sticker-preferences-${user?._id || 'guest'}`;
    try {
      setFavoriteStickerIds(JSON.parse(localStorage.getItem(`${key}-favorites`) || '[]'));
      setRecentStickerIds(JSON.parse(localStorage.getItem(`${key}-recent`) || '[]'));
    } catch (error) {
      console.error('Could not load sticker preferences:', error);
    }
  }, [user?._id]);

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
    const handleMessageHiddenForUser = (data) => {
      const isGroup = selectedChatRef.current?.type === 'group';
      if (isGroup) {
        if (String(data.groupId) !== String(selectedChatRef.current?._id)) return;
      } else if (data.groupId) {
        return;
      }
      setMessages((previous) => previous.filter((message) => String(message._id) !== String(data._id)));
      setSelectedMessageIds((previous) => previous.filter((id) => id !== String(data._id)));
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
    Socket.on('message-hidden-for-user', handleMessageHiddenForUser);
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
      Socket.off('message-hidden-for-user', handleMessageHiddenForUser);
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
        ...(replyTo?._id ? { replyToId: replyTo._id } : {}),
        ...(attachments.length ? { attachments } : {}),
      };

      if (chat.type === 'group') {
        Socket.emit('group-message', { ...payload, groupId: chat._id });
      } else {
        Socket.emit('send-message', { ...payload, receiver: chat._id });
      }
      setMsg('');
      setSelectedFiles([]);
      setReplyTo(null);
    } catch (error) {
      window.alert(error.response?.data?.message || 'Could not upload the selected files.');
    } finally {
      setIsSending(false);
    }
  };

  const sendSticker = (sticker) => {
    if (!selectedChat || !Socket.connected) return;
    const payload = { content: '', stickerId: sticker._id };
    Socket.emit(selectedChat.type === 'group' ? 'group-message' : 'send-message', selectedChat.type === 'group'
      ? { ...payload, groupId: selectedChat._id }
      : { ...payload, receiver: selectedChat._id });
    const key = `sticker-preferences-${user?._id || 'guest'}`;
    const recent = [String(sticker._id), ...recentStickerIds.filter((id) => String(id) !== String(sticker._id))].slice(0, 30);
    setRecentStickerIds(recent);
    localStorage.setItem(`${key}-recent`, JSON.stringify(recent));
    setShowStickers(false);
  };

  const toggleFavoriteSticker = (stickerId) => {
    const key = `sticker-preferences-${user?._id || 'guest'}`;
    const next = favoriteStickerIds.includes(String(stickerId))
      ? favoriteStickerIds.filter((id) => id !== String(stickerId))
      : [...favoriteStickerIds, String(stickerId)];
    setFavoriteStickerIds(next);
    localStorage.setItem(`${key}-favorites`, JSON.stringify(next));
  };

  const addSticker = async () => {
    if (!stickerName.trim() || !stickerFile) {
      setStickerError('Enter a sticker name and choose an image or GIF file.');
      return;
    }
    if (stickerFile.size > 8 * 1024 * 1024) {
      setStickerError('Sticker files must be 8 MB or smaller.');
      return;
    }
    setStickerError('');
    try {
      const formData = new FormData();
      formData.append('name', stickerName.trim());
      formData.append('category', stickerUploadCategory);
      formData.append('sticker', stickerFile);
      await axios.post(`${API_URL}/api/stickers/upload`, formData, {
        headers: { Authorization: `******'token') || ''}` },
        withCredentials: true,
      });
      await refreshStickerCatalog();
      setStickerName('');
      setStickerFile(null);
      setShowAddSticker(false);
    } catch (error) {
      setStickerError(error.response?.data?.message || 'Could not add sticker.');
    }
  };
  const removeSticker = async (sticker) => {
    if (String(sticker.ownerId) !== String(user?._id)) return;
    try {
      await axios.delete(`${API_URL}/api/stickers/${sticker._id}`, {
        headers: { Authorization: `******'token') || ''}` },
        withCredentials: true,
      });
      await refreshStickerCatalog();
      setFavoriteStickerIds((current) => current.filter((id) => id !== String(sticker._id)));
      setRecentStickerIds((current) => current.filter((id) => id !== String(sticker._id)));
    } catch (error) {
      setStickerError(error.response?.data?.message || 'Could not remove sticker.');
    }
  };
  const createStickerCategory = async () => {
    const name = newStickerCategory.trim();
    if (!name) return;
    try {
      const { data } = await axios.post(`${API_URL}/api/sticker-categories`, { name }, {
        headers: { Authorization: `******'token') || ''}` },
        withCredentials: true,
      });
      await refreshStickerCatalog();
      setStickerUploadCategory(data.name);
      setStickerCategory(data.name);
      setNewStickerCategory('');
      setStickerError('');
    } catch (error) {
      setStickerError(error.response?.data?.message || 'Could not create sticker category.');
    }
  };
  const displayedStickers = stickers.filter((sticker) => {
    if (stickerCategory === 'favorites') return favoriteStickerIds.includes(String(sticker._id));
    if (stickerCategory === 'recent') return recentStickerIds.includes(String(sticker._id));
    return stickerCategory === 'all' || sticker.category === stickerCategory;
  }).sort((a, b) => {
    if (stickerCategory !== 'recent') return 0;
    return recentStickerIds.indexOf(String(a._id)) - recentStickerIds.indexOf(String(b._id));
  });
  const getStickerUrl = (message) => (
    [message.stickerUrl, stickers.find((sticker) => String(sticker._id) === String(message.stickerId))?.imageUrl]
      .find(Boolean)
  );
  const resolveStickerUrl = (url) => stickerSources[url] || (url?.startsWith('/uploads/') ? `${API_URL}${url}` : '');
  const jumpToMessage = (message) => {
    if (!message) return;
    setHighlightedMessageId(String(message._id));
    messagesContainerRef.current?.querySelector(`[data-message-id="${message._id}"]`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
    window.setTimeout(() => {
      setHighlightedMessageId((current) => current === String(message._id) ? null : current);
    }, 3200);
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
      if (data.hiddenForMe) {
        setMessages((previous) => previous.filter((candidate) => String(candidate._id) !== String(data._id)));
        setSelectedMessageIds((previous) => previous.filter((id) => id !== String(data._id)));
      } else {
        setMessages((previous) => previous.map((candidate) =>
          String(candidate._id) === String(data._id) ? { ...candidate, ...data } : candidate
        ));
      }
    } catch (error) {
      window.alert(error.response?.data?.message || 'Could not delete this message.');
    }
  };

  const toggleSidebar = () => {
    setIsSidebarOpen((prev) => !prev);
  };
  const closeSidebar = () => setIsSidebarOpen(false);
  const cancelSelection = () => {
    setSelectedMessageIds([]);
    setIsSelectionMode(false);
    setOpenBulkMenu(false);
  };
  const toggleMessageSelection = (messageId) => {
    setSelectedMessageIds((current) => current.includes(String(messageId))
      ? current.filter((id) => id !== String(messageId))
      : [...current, String(messageId)]);
    setOpenMessageMenu(null);
  };
  const startSelection = (messageId) => {
    setIsSelectionMode(true);
    setSelectedMessageIds([String(messageId)]);
    setOpenMessageMenu(null);
  };
  const forwardMessage = (message) => {
    setPendingForward({ ...message, sourceChatId: selectedChat?._id });
    setIsSidebarOpen(true);
    setOpenMessageMenu(null);
  };
  const selectedMessages = messages.filter((message) => selectedMessageIds.includes(String(message._id)));
  const copySelectedMessages = async () => {
    const text = selectedMessages
      .map((message) => `${message.senderName || (String(message.sender) === String(user?._id) ? 'You' : 'Message')}: ${message.content || '[Attachment]'}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('Could not copy selected messages:', error);
      window.alert('Could not copy the selected messages.');
    }
    cancelSelection();
  };
  const copyMessage = async (message) => {
    const text = message.content || '[Attachment]';
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('Could not copy message:', error);
      window.alert('Could not copy this message.');
    }
    setOpenMessageMenu(null);
  };
  const deleteSelectedMessages = async () => {
    const deletable = selectedMessages.filter((message) => !message.isDeleted);
    await Promise.all(deletable.map((message) => deleteMessage(message)));
    cancelSelection();
  };
  const forwardSelectedMessages = () => {
    if (!selectedMessages.length) return;
    setPendingForward({
      content: selectedMessages.map((message) => message.content || '[Attachment]').join('\n'),
      sourceChatId: selectedChat?._id,
    });
    setIsSidebarOpen(true);
    cancelSelection();
  };

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
          {isSelectionMode ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <button type="button" onClick={cancelSelection} className="theme-text grid h-10 w-10 place-items-center rounded-xl border" title="Cancel selection" aria-label="Cancel selection">
                <FaTimes />
              </button>
              <h1 className="theme-text truncate text-lg font-semibold">{selectedMessageIds.length} selected</h1>
            </div>
          ) : selectedChat && (
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
          <div className="relative flex shrink-0 items-center justify-end gap-1 sm:gap-4">
            {isSelectionMode ? (
              <>
                <button
                  type="button"
                  onClick={() => setOpenBulkMenu((current) => !current)}
                  className="chat-action theme-text grid h-10 w-10 place-items-center rounded-xl border"
                  title="Selected message actions"
                  aria-label="Selected message actions"
                >
                  <FaEllipsisV />
                </button>
                {openBulkMenu && (
                  <div className="absolute right-0 top-12 z-40 min-w-40 rounded-lg border border-black/20 bg-slate-950 p-1 text-xs text-white shadow-xl">
                    <button type="button" onClick={deleteSelectedMessages} className="block w-full rounded px-2 py-2 text-left text-rose-300 hover:bg-white/10">
                      Delete selected
                    </button>
                    <button type="button" onClick={forwardSelectedMessages} className="block w-full rounded px-2 py-2 text-left hover:bg-white/10">
                      Forward selected
                    </button>
                    <button type="button" onClick={copySelectedMessages} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-white/10">
                      <FaCopy /> Copy selected
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
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
              </>
            )}
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
                className={`relative flex w-full min-w-0 touch-pan-y ${String(m.sender) === String(user?._id) ? 'justify-end' : 'justify-start'}`}
                style={{
                  transform: `translate3d(${replySwipe.messageId === String(m._id) ? replySwipe.offset : 0}px, 0, 0)`,
                  transition: replySwipe.messageId === String(m._id) && replySwipe.dragging ? 'none' : 'transform 180ms ease-out',
                }}
                onClick={() => isSelectionMode && toggleMessageSelection(m._id)}
                onPointerDown={(event) => {
                  if (isSelectionMode) return;
                  if (event.pointerType === 'mouse') return;
                  replyDrag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
                  setReplySwipe({ messageId: String(m._id), offset: 0, dragging: true });
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const start = replyDrag.current;
                  if (!start || isSelectionMode) return;
                  const signedDeltaX = event.clientX - start.x;
                  const deltaX = Math.abs(signedDeltaX);
                  const deltaY = Math.abs(event.clientY - start.y);
                  if (deltaX > 12 && deltaX > deltaY) {
                    event.preventDefault();
                    setReplySwipe({ messageId: String(m._id), offset: Math.max(-88, Math.min(88, signedDeltaX)), dragging: true });
                  }
                }}
                onPointerUp={(event) => {
                  const start = replyDrag.current;
                  replyDrag.current = null;
                  const deltaX = start ? event.clientX - start.x : 0;
                  const deltaY = start ? event.clientY - start.y : 0;
                  if (!isSelectionMode && Math.abs(deltaX) >= 70 && Math.abs(deltaX) > Math.abs(deltaY)) {
                    const replied = messages.find((candidate) => String(candidate._id) === String(m._id));
                    if (replied && !replied.isDeleted) setReplyTo(replied);
                  }
                  setReplySwipe({ messageId: String(m._id), offset: 0, dragging: false });
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => {
                  replyDrag.current = null;
                  setReplySwipe({ messageId: String(m._id), offset: 0, dragging: false });
                }}
              >
                <div
                  data-message-id={m._id}
                  className={`relative max-w-[min(82%,34rem)] rounded-2xl px-4 py-2.5 text-sm shadow ${String(m.sender) === String(user?._id)
                    ? 'chat-bubble-own rounded-br-sm'
                    : 'chat-bubble-peer rounded-bl-sm'
                    } ${highlightedMessageId === String(m._id) ? 'message-reply-highlight' : ''}`}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenMessageMenu((current) => current === String(m._id) ? null : String(m._id));
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    aria-label="Message actions"
                    title="Message actions"
                    className="absolute right-2 top-2 rounded-md p-1 opacity-60 transition hover:bg-black/20 hover:opacity-100"
                  >
                    <FaEllipsisV size={12} />
                  </button>
                  {openMessageMenu === String(m._id) && (
                    <div onClick={(event) => event.stopPropagation()} className={`absolute top-9 z-20 min-w-32 rounded-lg border border-black/20 bg-slate-950 p-1 text-xs text-white shadow-xl ${String(m.sender) === String(user?._id) ? 'right-0' : 'left-full ml-2'}`}>
                      {!m.isDeleted && (
                        <button type="button" onClick={() => { setReplyTo(m); setOpenMessageMenu(null); }} className="block w-full rounded px-2 py-1.5 text-left hover:bg-white/10">
                          Reply
                        </button>
                      )}
                      <button type="button" onClick={() => startSelection(m._id)} className="block w-full rounded px-2 py-1.5 text-left hover:bg-white/10">
                        Select
                      </button>
                      <button type="button" onClick={() => forwardMessage(m)} className="block w-full rounded px-2 py-1.5 text-left hover:bg-white/10">
                        Forward
                      </button>
                      <button type="button" onClick={() => copyMessage(m)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-white/10">
                        <FaCopy /> Copy
                      </button>
                      {!m.isDeleted && (
                        <button type="button" onClick={() => { setOpenMessageMenu(null); deleteMessage(m); }} className="block w-full rounded px-2 py-1.5 text-left text-rose-300 hover:bg-white/10">
                          {String(m.sender) === String(user?._id) ? 'Delete for everyone' : 'Delete for me'}
                        </button>
                      )}
                    </div>
                  )}
                  {selectedMessageIds.includes(String(m._id)) && (
                    <span className="absolute -left-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-teal-400 text-[10px] font-bold text-slate-950">✓</span>
                  )}
                  {(selectedChat.type === 'group' || String(m.sender) !== String(user?._id)) && <p className={`mb-0.5 text-xs font-semibold ${String(m.sender) === String(user?._id) ? 'text-teal-100' : 'text-teal-800'}`}>
                    {String(m.sender) === String(user?._id) ? 'You' : m.senderName || selectedChat.username}
                  </p>}
                  {m.content && (
                    <p className={`whitespace-pre-wrap break-words ${m.isDeleted ? 'italic opacity-75' : ''}`}>{m.content}</p>
                  )}
                  {getStickerUrl(m) && !m.isDeleted && (
                                    <img
                                      src={resolveStickerUrl(getStickerUrl(m))}
                      alt="Sticker"
                      className="mt-1 h-28 w-28 object-contain"
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                        event.currentTarget.nextElementSibling?.removeAttribute('hidden');
                      }}
                    />
                  )}
                  {m.stickerId && !m.isDeleted && (
                    <a
                      hidden={Boolean(getStickerUrl(m))}
                      className="mt-1 block text-xs text-teal-200 underline"
                    >
                      Sticker unavailable.
                    </a>
                  )}
                  {(m.replyToId || (!m.isDeleted && getAttachments(m).length > 0)) && (
                    <div className="mt-2 flex max-w-full items-start gap-2">
                    {m.replyToId && (() => {
                      const quoted = messages.find((candidate) => String(candidate._id) === String(m.replyToId));
                      return (
                        <div
                          onClick={() => jumpToMessage(quoted)}
                          className="flex min-w-0 max-w-[52%] cursor-pointer items-center gap-2 rounded-md border border-teal-200/40 bg-slate-950/80 px-2 py-1.5 text-left text-xs text-teal-50 shadow-inner"
                        >
                          <FaReply className="shrink-0 text-teal-300" />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">Replying to {quoted?.senderName || m.replySenderName || (String(quoted?.sender) === String(user?._id) ? 'You' : 'message')}</span>
                            <span className="block truncate">{quoted?.content || m.replyContent || 'Attachment'}</span>
                          </span>
                        </div>
                      );
                    })()}
                  {!m.isDeleted && getAttachments(m).length > 0 && (
                    <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
                    {getAttachments(m).map((attachment) => (
                    <div key={attachment.url} className="max-w-full">
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
                    </div>
                  )}
                    </div>
                  )}
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
        <footer
          ref={footerRef}
          className="theme-footer fixed inset-x-0 bottom-0 z-30 box-border w-full min-w-0 rounded-t-2xl border px-[max(0.75rem,env(safe-area-inset-left))] pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl sm:px-8 sm:py-4"
        >
          {selectedChat && !socketConnected && (
            <p role="status" className="mx-auto mb-2 max-w-4xl text-xs text-amber-200">
              Reconnecting to chat… Messages will send when the connection is restored.
            </p>
          )}
          {pendingForward && (
            <p className="mx-auto mb-2 max-w-4xl text-xs text-teal-200">
              Choose a chat from the sidebar to forward this message.
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
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setShowStickers((current) => !current)}
                disabled={!selectedChat || isSending}
                className="chat-action theme-text grid h-10 w-10 place-items-center rounded-xl border transition hover:text-teal-500 disabled:opacity-50"
                title="Stickers"
                aria-label="Open stickers"
              >
                <FaSmile />
              </button>
              {showStickers && (
                <div className="absolute bottom-12 left-0 z-40 w-64 rounded-xl border border-white/15 bg-slate-950 p-3 shadow-xl">
                  <div className="mb-2 flex flex-wrap gap-1 border-b border-white/10 pb-2">
                    {['all', 'favorites', 'recent', ...stickerCategories].map((category) => (
                      <button type="button" key={category} onClick={() => setStickerCategory(category)} className={`rounded px-2 py-1 text-[11px] capitalize ${stickerCategory === category ? 'bg-teal-500 text-slate-950' : 'text-white/70 hover:bg-white/10'}`}>
                        {category === 'all' ? 'All' : category}
                      </button>
                    ))}
                  </div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <button type="button" onClick={() => setShowAddSticker((current) => !current)} className="rounded bg-teal-500 px-2 py-1 text-[11px] font-semibold text-slate-950">
                      {showAddSticker ? 'Close add' : 'Add sticker'}
                    </button>
                    <span className="text-[11px] text-white/50">Images and GIFs</span>
                  </div>
                  {showAddSticker && (
                    <div className="mb-2 space-y-2 border-b border-white/10 pb-2 text-left">
                      <input value={stickerName} onChange={(event) => setStickerName(event.target.value)} required maxLength={100} placeholder="Sticker name" className="w-full rounded border border-white/20 bg-white/10 px-2 py-1 text-xs text-white outline-none" />
                      <select value={stickerUploadCategory} onChange={(event) => setStickerUploadCategory(event.target.value)} className="w-full rounded border border-white/20 bg-slate-900 px-2 py-1 text-xs text-white">
                        {stickerCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                      </select>
                      <div className="flex gap-1">
                        <input value={newStickerCategory} onChange={(event) => setNewStickerCategory(event.target.value)} maxLength={60} placeholder="New shared category" className="min-w-0 flex-1 rounded border border-white/20 bg-white/10 px-2 py-1 text-xs text-white outline-none" />
                        <button type="button" onClick={createStickerCategory} className="rounded border border-white/20 px-2 text-[11px]">Add category</button>
                      </div>
                      <input type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif" onChange={(event) => setStickerFile(event.target.files?.[0] || null)} className="w-full text-[11px] text-white/70" />
                      {stickerError && <p className="text-xs text-rose-300">{stickerError}</p>}
                      <button type="button" onClick={addSticker} className="rounded bg-teal-500 px-2 py-1 text-[11px] font-semibold text-slate-950">Add</button>
                    </div>
                  )}
                  {displayedStickers.length ? (
                    <div className="grid max-h-48 grid-cols-5 gap-2 overflow-y-auto">
                    {displayedStickers.map((sticker) => (
                      <div key={sticker._id} className="relative rounded-lg p-1 hover:bg-white/10">
                        <button type="button" onClick={() => sendSticker(sticker)} title={sticker.name} className="block">
                          <img src={resolveStickerUrl(sticker.imageUrl)} alt={sticker.name} className="h-10 w-10 object-contain" loading="lazy" />
                        </button>
                        <button type="button" onClick={() => toggleFavoriteSticker(sticker._id)} className={`absolute -right-1 -top-1 ${favoriteStickerIds.includes(String(sticker._id)) ? 'text-yellow-300' : 'text-white/40'}`} aria-label="Toggle favorite">
                          <FaStar size={9} />
                        </button>
                        {String(sticker.ownerId) === String(user?._id) && (
                          <button type="button" onClick={() => removeSticker(sticker)} className="absolute -bottom-1 -right-1 text-[9px] text-rose-300" aria-label="Remove sticker">
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    </div>
                  ) : (
                    <div className="col-span-5 space-y-2 text-center text-xs text-white/70">
                      <p>{stickers.length ? `No ${stickerCategory} stickers yet.` : 'No stickers available yet.'}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            <input
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              className="theme-composer-input min-w-0 flex-1 bg-transparent px-3 py-3 text-base outline-none placeholder:opacity-60 sm:text-sm"
              placeholder={selectedChat ? `Message ${selectedChat.name || selectedChat.username}...` : 'Choose a conversation first'}
              disabled={!selectedChat || isSending}
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
            {replyTo && (
              <div className="flex min-w-0 max-w-[42%] shrink items-center gap-1.5 rounded-xl border border-teal-300/30 bg-slate-950/40 px-2 py-1.5 text-xs">
                <FaReply className="shrink-0 text-teal-300" />
                <span className="min-w-0 flex-1 truncate">{replyTo.content || 'Attachment'}</span>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  className="shrink-0 text-white/60 hover:text-white"
                  aria-label="Cancel reply"
                  title="Cancel reply"
                >
                  ×
                </button>
              </div>
            )}
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
