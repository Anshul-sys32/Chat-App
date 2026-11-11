import React, { Suspense, lazy, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import Sidebar from './Sidebar';
import Socket from '../Socket';
import { connectAndRegisterUser } from "../Socket";
import { FaCalendarAlt, FaCode, FaCopy, FaEllipsisV, FaHashtag, FaMicrophone, FaPaperclip, FaPencilAlt, FaPhone, FaReply, FaSearch, FaSmile, FaStar, FaTasks, FaTimes, FaTrophy, FaUsers, FaVideo } from 'react-icons/fa';
import VideoCall from './VideoCall';
import AdminPanel from './AdminPanel';
import NotificationCenter from './NotificationCenter';
import VoiceRecorder from './VoiceRecorder';
import VoiceMessagePlayer from './VoiceMessagePlayer';
import Avatar from './Avatar';
import CommunityPostCard from './CommunityPostCard';
import CommunityWhiteboard from './CommunityWhiteboard';
import MarkdownMessage from './MarkdownMessage';
import { loadStickerCatalog, releaseStickerSources } from '../stickerCache';
import FloatingPanel from './FloatingPanel';
import useFloatingPanel from '../useFloatingPanel';
import { normalizeNotificationTarget } from '../notificationDeliveryPolicy';

const CommunityCodeRoom = lazy(() => import('./CommunityCodeRoom'));

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";
const MAX_FILES_PER_MESSAGE = 5;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MESSAGE_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];
const COMMUNITY_QUESTION_CATEGORIES = ['General', 'Development', 'Bug', 'Help', 'Feature request'];
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
      && (attachment.url.startsWith('/uploads/') || attachment.url.startsWith('/api/voice-media/'))
      && typeof attachment.mimeType === 'string')
    : [];
};

const formatFileSize = (size) => {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export default function Chat({ user, selectedChat, onSelectChat, onUserUpdated, theme, onToggleTheme, accent, onChangeAccent }) {
  const [msg, setMsg] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [voiceFile, setVoiceFile] = useState(null);
  const [voicePreviewUrl, setVoicePreviewUrl] = useState('');
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [conversationMuted, setConversationMuted] = useState(false);
  const [conversationMuteLoading, setConversationMuteLoading] = useState(false);
  const [conversationMuteSaving, setConversationMuteSaving] = useState(false);
  const [conversationMuteError, setConversationMuteError] = useState('');
  const fileInputRef = React.useRef(null);
  const [messages, setMessages] = useState([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktopPanelOpen, setIsDesktopPanelOpen] = useState(true);
  const [isVideoOpen, setIsVideoOpen] = useState(false);
  const [socketConnected, setSocketConnected] = useState(Socket.connected);
  const [callType, setCallType] = useState('video');
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [messagesAttempt, setMessagesAttempt] = useState(0);
  const messagesRequestId = React.useRef(0);
  const pendingSearchTargetRef = React.useRef(null);
  const messagesContainerRef = React.useRef(null);
  const scrollToLatestOnLoad = React.useRef(false);
  const pendingScrollAdjustment = React.useRef(null);
  const loadingOlderRef = React.useRef(false);
  const [messagesHasMore, setMessagesHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const footerRef = React.useRef(null);
  const [footerHeight, setFooterHeight] = useState(0);
  const [replyTo, setReplyTo] = useState(null);
  const [activeThread, setActiveThread] = useState(null);
  const [communityComposerType, setCommunityComposerType] = useState('message');
  const [questionCategory, setQuestionCategory] = useState('General');
  const [questionTags, setQuestionTags] = useState('');
  const [communityPostFilter, setCommunityPostFilter] = useState('all');
  const [communityCategoryFilter, setCommunityCategoryFilter] = useState('all');
  const [communityTagFilter, setCommunityTagFilter] = useState('');
  const [communityPostSort, setCommunityPostSort] = useState('newest');
  const [pollDraft, setPollDraft] = useState({ question: '', options: ['', ''], multipleChoice: false });
  const [eventDraft, setEventDraft] = useState({ title: '', description: '', location: '', startsAt: '' });
  const [announcementDraft, setAnnouncementDraft] = useState({ content: '', scheduledAt: '', recurrence: 'once' });
  const [scheduledAnnouncements, setScheduledAnnouncements] = useState([]);
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const [announcementError, setAnnouncementError] = useState('');
  const [savedMessages, setSavedMessages] = useState([]);
  const [savedMessagesOpen, setSavedMessagesOpen] = useState(false);
  const [savedMessagesLoading, setSavedMessagesLoading] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalSearchFilter, setGlobalSearchFilter] = useState('all');
  const [globalSearchFrom, setGlobalSearchFrom] = useState('');
  const [globalSearchTo, setGlobalSearchTo] = useState('');
  const [globalSearchResults, setGlobalSearchResults] = useState([]);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchError, setGlobalSearchError] = useState('');
  const [scheduledMessages, setScheduledMessages] = useState([]);
  const [scheduledMessagesOpen, setScheduledMessagesOpen] = useState(false);
  const [scheduledMessageAt, setScheduledMessageAt] = useState('');
  const [editingScheduledMessageId, setEditingScheduledMessageId] = useState(null);
  const [scheduledMessageSaving, setScheduledMessageSaving] = useState(false);
  const [scheduledMessageError, setScheduledMessageError] = useState('');
  const [reputationOpen, setReputationOpen] = useState(false);
  const [reputationData, setReputationData] = useState(null);
  const [reputationLoading, setReputationLoading] = useState(false);
  const [reputationError, setReputationError] = useState('');
  const [tasksOpen, setTasksOpen] = useState(false);
  const [communityTasks, setCommunityTasks] = useState([]);
  const [taskMembers, setTaskMembers] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState('');
  const [taskDraft, setTaskDraft] = useState({ title: '', description: '', assignedTo: '', dueAt: '', linkedMessageId: '' });
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [codeRoomOpen, setCodeRoomOpen] = useState(false);
  const [openMessageMenu, setOpenMessageMenu] = useState(null);
  const [openReactionPicker, setOpenReactionPicker] = useState(null);
  const messageMenuRef = React.useRef(null);
  const messageMenuTriggerRef = React.useRef(null);
  const [messageMenuPosition, setMessageMenuPosition] = useState(null);
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
  const suppressMessageClick = React.useRef(false);
  const joinGroupKeyRef = React.useRef('');
  const [replySwipe, setReplySwipe] = useState({ messageId: null, offset: 0, dragging: false });
  const bulkPanel = useFloatingPanel(openBulkMenu, () => setOpenBulkMenu(false));
  const stickerPanel = useFloatingPanel(showStickers, () => setShowStickers(false));

  useEffect(() => {
    if (!voiceFile) {
      setVoicePreviewUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(voiceFile);
    setVoicePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [voiceFile]);

  useEffect(() => () => {
    if (replyDrag.current?.timer) window.clearTimeout(replyDrag.current.timer);
  }, []);

  const toggleMessageMenu = (event, messageId) => {
    event.stopPropagation();
    if (openMessageMenu === String(messageId)) {
      setOpenMessageMenu(null);
      setMessageMenuPosition(null);
      messageMenuTriggerRef.current = null;
      return;
    }
    messageMenuTriggerRef.current = event.currentTarget;
    setOpenMessageMenu(String(messageId));
  };

  useLayoutEffect(() => {
    if (!openMessageMenu || !messageMenuRef.current || !messageMenuTriggerRef.current) return undefined;
    const menu = messageMenuRef.current;
    const trigger = messageMenuTriggerRef.current;
    const visualViewport = window.visualViewport;
    const margin = 8;
    const viewportLeft = visualViewport?.offsetLeft || 0;
    const viewportTop = visualViewport?.offsetTop || 0;
    const viewportWidth = visualViewport?.width || window.innerWidth;
    const viewportHeight = visualViewport?.height || window.innerHeight;
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const maxWidth = Math.max(0, viewportWidth - margin * 2);
    const maxHeight = Math.max(0, viewportHeight - margin * 2);
    const width = Math.min(menuRect.width, maxWidth);
    const height = Math.min(menuRect.height, maxHeight);
    const left = Math.min(
      Math.max(triggerRect.right - width, viewportLeft + margin),
      viewportLeft + viewportWidth - width - margin,
    );
    const below = triggerRect.bottom + 4;
    const above = triggerRect.top - height - 4;
    const preferredTop = below + height <= viewportTop + viewportHeight - margin
      ? below
      : above;
    const top = Math.min(
      Math.max(preferredTop, viewportTop + margin),
      viewportTop + viewportHeight - height - margin,
    );
    setMessageMenuPosition({ left, top, maxWidth, maxHeight });
    return undefined;
  }, [openMessageMenu]);

  useEffect(() => {
    if (!openMessageMenu) return undefined;
    const messagesContainer = messagesContainerRef.current;
    const dismissOutside = (event) => {
      if (messageMenuRef.current?.contains(event.target)
        || messageMenuTriggerRef.current?.contains(event.target)) return;
      setOpenMessageMenu(null);
      setMessageMenuPosition(null);
      messageMenuTriggerRef.current = null;
    };
    const dismissOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setOpenMessageMenu(null);
      setMessageMenuPosition(null);
      messageMenuTriggerRef.current = null;
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('keydown', dismissOnEscape);
    messagesContainer?.addEventListener('scroll', dismissOutside, { passive: true });
    window.visualViewport?.addEventListener('resize', dismissOutside, { passive: true });
    window.visualViewport?.addEventListener('scroll', dismissOutside, { passive: true });
    window.addEventListener('resize', dismissOutside, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('keydown', dismissOnEscape);
      messagesContainer?.removeEventListener('scroll', dismissOutside);
      window.visualViewport?.removeEventListener('resize', dismissOutside);
      window.visualViewport?.removeEventListener('scroll', dismissOutside);
      window.removeEventListener('resize', dismissOutside);
    };
  }, [openMessageMenu]);

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
    setActiveThread(null);
    setCommunityComposerType('message');
    setQuestionCategory('General');
    setQuestionTags('');
    setCommunityPostFilter('all');
    setCommunityCategoryFilter('all');
    setCommunityTagFilter('');
    setCommunityPostSort('newest');
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
    const handleMessageError = ({ message }) => {
      const isTransientGroupJoinError = message === 'Could not join this group right now.'
        && selectedChatRef.current?.type === 'group';
      if (isTransientGroupJoinError) return;
      window.alert(message);
    };
    const handleScheduledMessageUpdated = ({ id }) => {
      setScheduledMessages((previous) => previous.filter((message) => String(message.id) !== String(id)));
    };
    const handleCommunityTaskUpdated = ({ groupId, task }) => {
      if (selectedChatRef.current?.type !== 'group' || String(groupId) !== String(selectedChatRef.current?._id)) return;
      setCommunityTasks((previous) => previous.some((item) => String(item.id) === String(task.id))
        ? previous.map((item) => String(item.id) === String(task.id) ? task : item)
        : [task, ...previous]);
    };
    const handleCommunityTaskDeleted = ({ groupId, taskId }) => {
      if (selectedChatRef.current?.type !== 'group' || String(groupId) !== String(selectedChatRef.current?._id)) return;
      setCommunityTasks((previous) => previous.filter((task) => String(task.id) !== String(taskId)));
    };
    const handleGroupMessage = (data) => {
      if (selectedChatRef.current?.type !== 'group') return;
      if (String(data.groupId) !== String(selectedChatRef.current?._id)) return;
      if (String(data.channelId || '') !== String(selectedChatRef.current?.channelId || '')) return;
      setMessages((previous) => previous.some((message) => message._id === data._id)
        ? previous
        : [...previous, data]);
    };
    const handleGroupEngagement = (data) => {
      if (selectedChatRef.current?.type !== 'group'
        || String(data.groupId) !== String(selectedChatRef.current?._id)
        || String(data.channelId || '') !== String(selectedChatRef.current?.channelId || '')) return;
      setMessages((previous) => previous.map((message) => String(message._id) === String(data._id)
        ? {
          ...message,
          ...(data.pollResults ? { pollResults: data.pollResults } : {}),
          ...(data.eventResults ? { eventResults: data.eventResults } : {}),
          ...(data.reactions ? { reactions: data.reactions } : {}),
        }
        : message));
    };
    const handleDirectMessageEngagement = (data) => {
      if (selectedChatRef.current?.type === 'group') return;
      const selectedId = String(selectedChatRef.current?._id);
      const currentUserId = String(user?._id);
      const matchesConversation = (
        String(data.sender) === currentUserId && String(data.receiver) === selectedId
      ) || (
        String(data.sender) === selectedId && String(data.receiver) === currentUserId
      );
      if (!matchesConversation) return;
      setMessages((previous) => previous.map((message) => String(message._id) === String(data._id)
        ? { ...message, reactions: data.reactions }
        : message));
    };
    const handleMessageUpdated = (data) => {
      if (data.groupId) {
        if (selectedChatRef.current?.type !== 'group'
          || String(data.groupId) !== String(selectedChatRef.current?._id)
          || String(data.channelId || '') !== String(selectedChatRef.current?.channelId || '')) return;
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
    const handleChannelArchived = ({ groupId, channelId }) => {
      if (selectedChatRef.current?.type !== 'group'
        || String(selectedChatRef.current?._id) !== String(groupId)
        || String(selectedChatRef.current?.channelId) !== String(channelId)) return;
      setMessages([]);
      onSelectChat(null);
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
    Socket.on('scheduled-message-updated', handleScheduledMessageUpdated);
    Socket.on('community-task-updated', handleCommunityTaskUpdated);
    Socket.on('community-task-deleted', handleCommunityTaskDeleted);
    Socket.on('group-message', handleGroupMessage);
    Socket.on('group-message-engagement', handleGroupEngagement);
    Socket.on('direct-message-engagement', handleDirectMessageEngagement);
    Socket.on('message-updated', handleMessageUpdated);
    Socket.on('group-message-updated', handleMessageUpdated);
    Socket.on('message-hidden-for-user', handleMessageHiddenForUser);
    Socket.on('group-member-removed', handleRemovedFromGroup);
    Socket.on('group-deactivated', handleRemovedFromGroup);
    Socket.on('group-channel-archived', handleChannelArchived);
    Socket.on('profile-picture-updated', handleProfilePicture);
    Socket.on('group-picture-updated', handleGroupPicture);

    return () => {
      Socket.off('receive-message', handleReceive);
      Socket.off('message-sent', handleSent);
      Socket.off('message-error', handleMessageError);
      Socket.off('scheduled-message-updated', handleScheduledMessageUpdated);
      Socket.off('community-task-updated', handleCommunityTaskUpdated);
      Socket.off('community-task-deleted', handleCommunityTaskDeleted);
      Socket.off('group-message', handleGroupMessage);
      Socket.off('group-message-engagement', handleGroupEngagement);
      Socket.off('direct-message-engagement', handleDirectMessageEngagement);
      Socket.off('message-updated', handleMessageUpdated);
      Socket.off('group-message-updated', handleMessageUpdated);
      Socket.off('message-hidden-for-user', handleMessageHiddenForUser);
      Socket.off('group-member-removed', handleRemovedFromGroup);
      Socket.off('group-deactivated', handleRemovedFromGroup);
      Socket.off('group-channel-archived', handleChannelArchived);
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
  const conversationMuteRequestRef = React.useRef(0);

  useEffect(() => {
    setScheduledMessages([]);
    setScheduledMessageError('');
    setScheduledMessageAt('');
    setEditingScheduledMessageId(null);
    if (!selectedChat?._id) return undefined;
    let active = true;
    const type = selectedChat.type === 'group' ? 'group' : 'direct';
    axios.get(`${API_URL}/api/scheduled-messages`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      params: {
        type,
        conversationId: selectedChat._id,
        ...(type === 'group' && selectedChat.channelId ? { channelId: selectedChat.channelId } : {}),
      },
      withCredentials: true,
    }).then(({ data }) => {
      if (active) setScheduledMessages(data.messages || []);
    }).catch((error) => {
      if (active) setScheduledMessageError(error.response?.data?.message || 'Could not load scheduled messages.');
    });
    return () => { active = false; };
  }, [selectedChat?._id, selectedChat?.type, selectedChat?.channelId]);

  useEffect(() => {
    conversationMuteRequestRef.current += 1;
    setConversationMuteSaving(false);
    if (!selectedChat?._id) {
      setConversationMuted(false);
      setConversationMuteLoading(false);
      setConversationMuteError('');
      return undefined;
    }
    let active = true;
    const conversationType = selectedChat.type === 'group' ? 'group' : 'direct';
    setConversationMuteLoading(true);
    setConversationMuteError('');
    axios.get(`${API_URL}/api/conversations/${conversationType}/${selectedChat._id}/notification-preferences`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      withCredentials: true,
    }).then(({ data }) => {
      if (active) setConversationMuted(Boolean(data.muted));
    }).catch((error) => {
      if (active) setConversationMuteError(error.response?.data?.message || 'Could not load mute settings.');
    }).finally(() => {
      if (active) setConversationMuteLoading(false);
    });
    return () => { active = false; };
  }, [selectedChat?._id, selectedChat?.type]);

  const toggleConversationMute = async () => {
    const chat = selectedChatRef.current;
    if (!chat?._id || conversationMuteLoading || conversationMuteSaving) return;
    const requestId = conversationMuteRequestRef.current;
    const conversationType = chat.type === 'group' ? 'group' : 'direct';
    const muted = !conversationMuted;
    setConversationMuteSaving(true);
    setConversationMuteError('');
    try {
      const { data } = await axios.patch(
        `${API_URL}/api/conversations/${conversationType}/${chat._id}/notification-preferences`,
        { muted },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
          withCredentials: true,
        }
      );
      if (requestId === conversationMuteRequestRef.current) setConversationMuted(Boolean(data.muted));
    } catch (error) {
      if (requestId === conversationMuteRequestRef.current) {
        setConversationMuteError(error.response?.data?.message || 'Could not update mute settings.');
      }
    } finally {
      if (requestId === conversationMuteRequestRef.current) setConversationMuteSaving(false);
    }
  };

  const navigateToNotificationTarget = ({ targetType, targetId, targetName, targetChannelId, targetChannelName }) => {
    const target = normalizeNotificationTarget({ targetType, targetId, targetName, targetChannelId, targetChannelName });
    if (target) onSelectChat(target);
  };

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
    const pendingTarget = pendingSearchTargetRef.current;
    const targetMatchesChat = pendingTarget && (isGroup
      ? pendingTarget.messageType === 'group'
        && String(pendingTarget.groupId) === chatId
        && String(pendingTarget.channelId || '') === String(selectedChat.channelId || '')
      : pendingTarget.messageType === 'direct' && String(pendingTarget.conversationId) === chatId);
    setMessages([]);
    setMessagesHasMore(false);
    setMessagesError('');
    setMessagesLoading(true);
    scrollToLatestOnLoad.current = !targetMatchesChat;
    const joinGroup = () => {
      const nextJoinKey = `${selectedChat._id}:${selectedChat.type}:${selectedChat.channelId ?? 'default'}`;
      if (!Socket.connected || joinGroupKeyRef.current === nextJoinKey) return;
      joinGroupKeyRef.current = nextJoinKey;
      Socket.emit('join-group', {
        groupId: selectedChat._id,
        ...(selectedChat.channelId ? { channelId: selectedChat.channelId } : {}),
      });
    };
    if (isGroup) {
      joinGroup();
      Socket.on('connect', joinGroup);
    }
    const loadMessages = async () => {
      setMessagesError('');
      try {
        const historyUrl = isGroup
          ? `${API_URL}/api/groups/${selectedChat._id}/messages${selectedChat.channelId ? `?channelId=${encodeURIComponent(selectedChat.channelId)}` : ''}`
          : `${API_URL}/api/messages/${selectedChat._id}`;
        const historyParams = targetMatchesChat ? {
          before: (BigInt(pendingTarget._id) + 1n).toString(),
          limit: 50,
        } : undefined;
        const { data } = await axios.get(
          historyUrl,
          {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
            ...(historyParams ? { params: historyParams } : {}),
          }
        );
        if (!Array.isArray(data.messages) || typeof data.hasMore !== 'boolean') {
          throw new Error('The server returned an invalid message history.');
        }
        if (requestId !== messagesRequestId.current) return;
        if (targetMatchesChat && !data.messages.some((message) => String(message._id) === String(pendingTarget._id))) {
          pendingSearchTargetRef.current = null;
          scrollToLatestOnLoad.current = true;
        }
        setMessagesHasMore(data.hasMore);
        if (active) {
          setMessages((current) => {
            const messagePrefix = isGroup
              ? `group:${chatId}:${selectedChat.channelId || 'standard'}:`
              : `direct:${currentUserId}:${chatId}:`;
            const byId = new Map(data.messages.map((message) => [`${messagePrefix}${message._id}`, message]));
            current.forEach((message) => {
              const belongsToConversation = isGroup
                ? String(message.groupId) === chatId
                  && String(message.channelId || '') === String(selectedChat.channelId || '')
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
      joinGroupKeyRef.current = '';
      window.removeEventListener('pageshow', refreshWhenVisible);
      window.removeEventListener('online', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [selectedChat?._id, selectedChat?.type, selectedChat?.channelId, messagesAttempt, user?._id]);

  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const searchTarget = pendingSearchTargetRef.current;
    const targetMatchesChat = searchTarget && selectedChat && (searchTarget.messageType === 'group'
      ? selectedChat.type === 'group'
        && String(searchTarget.groupId) === String(selectedChat._id)
        && String(searchTarget.channelId || '') === String(selectedChat.channelId || '')
      : selectedChat.type !== 'group' && String(searchTarget.conversationId) === String(selectedChat._id));
    if (targetMatchesChat && !messagesLoading) {
      pendingSearchTargetRef.current = null;
      scrollToLatestOnLoad.current = false;
      const targetId = String(searchTarget._id);
      const targetElement = container.querySelector(`[data-message-id="${targetId}"]`);
      if (targetElement) {
        setHighlightedMessageId(targetId);
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => setHighlightedMessageId((current) => current === targetId ? null : current), 3200);
      }
      return;
    }
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
          params: {
            before: String(oldestMessage._id),
            limit: 50,
            ...(isGroup && chat.channelId ? { channelId: chat.channelId } : {}),
          },
        }
      );
      if (!Array.isArray(data.messages) || typeof data.hasMore !== 'boolean') {
        throw new Error('The server returned an invalid message history.');
      }
      const currentChat = selectedChatRef.current;
      if (!currentChat || String(currentChat._id) !== chatId || currentChat.type !== chat.type
        || String(currentChat.channelId || '') !== String(chat.channelId || '')) return;
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
    if (selectedFiles.length + incomingFiles.length + (voiceFile ? 1 : 0) > MAX_FILES_PER_MESSAGE) {
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
    const isCommunity = selectedChat?.type === 'group' && selectedChat.groupType === 'community';
    const composerType = isCommunity ? communityComposerType : 'message';
    const isStructured = ['poll', 'event'].includes(composerType);
    const hasContent = composerType === 'poll'
      ? pollDraft.question.trim() && pollDraft.options.filter((option) => option.trim()).length >= 2
      : composerType === 'event'
        ? eventDraft.title.trim() && eventDraft.startsAt
        : msg.trim();
    if ((!hasContent && !selectedFiles.length && !voiceFile) || !selectedChat?._id || isSending || !canPostToCommunityChannel) return;
    if (isStructured && (selectedFiles.length || voiceFile)) return;
    if (!Socket.connected) {
      setSocketConnected(false);
      return;
    }
    const chat = selectedChat;
    setIsSending(true);
    try {
      let attachments = [];
      if (voiceFile) {
        const formData = new FormData();
        formData.append('type', chat.type === 'group' ? 'group' : 'direct');
        formData.append('targetId', chat._id);
        if (chat.type === 'group' && chat.channelId) formData.append('channelId', chat.channelId);
        formData.append('file', voiceFile);
        const { data } = await axios.post(`${API_URL}/api/voice-uploads`, formData, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
          withCredentials: true,
        });
        attachments.push(data);
      }
      if (selectedFiles.length) {
        const formData = new FormData();
        formData.append('type', chat.type === 'group' ? 'group' : 'direct');
        formData.append('targetId', chat._id);
        if (chat.type === 'group' && chat.channelId) formData.append('channelId', chat.channelId);
        selectedFiles.forEach((file) => formData.append('files', file));
        const { data } = await axios.post(`${API_URL}/api/uploads`, formData, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
          withCredentials: true,
        });
        attachments = [...attachments, ...data];
      }
      const payload = {
        content: composerType === 'poll'
          ? pollDraft.question.trim()
          : composerType === 'event'
            ? eventDraft.title.trim()
            : msg.trim(),
        ...(replyTo?._id ? { replyToId: replyTo._id } : {}),
        ...(attachments.length ? { attachments } : {}),
        ...(isCommunity ? { messageType: composerType } : {}),
        ...(composerType === 'poll' ? {
          structuredData: {
            question: pollDraft.question.trim(),
            options: pollDraft.options.map((option) => option.trim()).filter(Boolean),
            multipleChoice: pollDraft.multipleChoice,
          },
        } : {}),
        ...(composerType === 'question' ? {
          structuredData: {
            category: questionCategory,
            tags: questionTags.split(/[\s,;]+/).map((tag) => tag.trim().replace(/^#/, '').toLowerCase()).filter(Boolean).slice(0, 5),
          },
        } : {}),
        ...(composerType === 'event' ? {
          structuredData: { ...eventDraft, startsAt: new Date(eventDraft.startsAt).toISOString() },
        } : {}),
      };

      if (chat.type === 'group') {
        Socket.emit('group-message', {
          ...payload,
          groupId: chat._id,
          ...(chat.channelId ? { channelId: chat.channelId } : {}),
        });
      } else {
        Socket.emit('send-message', { ...payload, receiver: chat._id });
      }
      setMsg('');
      setSelectedFiles([]);
      setVoiceFile(null);
      setReplyTo(null);
      if (composerType === 'poll') setPollDraft({ question: '', options: ['', ''], multipleChoice: false });
      if (composerType === 'question') {
        setQuestionCategory('General');
        setQuestionTags('');
      }
      if (composerType === 'event') setEventDraft({ title: '', description: '', location: '', startsAt: '' });
    } catch (error) {
      window.alert(error.response?.data?.message || 'Could not upload the selected files.');
    } finally {
      setIsSending(false);
    }
  };

  const updateCommunityEngagement = async (message, action, payload) => {
    const chat = selectedChatRef.current;
    if (chat?.type !== 'group' || chat.groupType !== 'community') return;
    try {
      const request = action === 'event-rsvp' ? axios.put : axios.post;
      const { data } = await request(
        `${API_URL}/api/groups/${chat._id}/messages/${message._id}/${action}`,
        payload,
        { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }, withCredentials: true }
      );
      setMessages((previous) => previous.map((item) => String(item._id) === String(message._id)
        ? { ...item, ...data }
        : item));
    } catch (error) {
      window.alert(error.response?.data?.message || 'Could not update this community post.');
    }
  };

  const voteInPoll = (message, optionIndexes) => updateCommunityEngagement(message, 'poll-votes', { optionIndexes });
  const respondToEvent = (message, response) => updateCommunityEngagement(message, 'event-rsvp', { response });

  const scheduleAnnouncement = async (event) => {
    event.preventDefault();
    const chat = selectedChatRef.current;
    if (!chat || !announcementDraft.content.trim() || !announcementDraft.scheduledAt || announcementSaving) return;
    setAnnouncementSaving(true);
    setAnnouncementError('');
    try {
      const { data } = await axios.post(
        `${API_URL}/api/groups/${chat._id}/channels/${chat.channelId}/scheduled-posts`,
        {
          content: announcementDraft.content.trim(),
          scheduledAt: new Date(announcementDraft.scheduledAt).toISOString(),
          recurrence: announcementDraft.recurrence,
        },
        { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }, withCredentials: true }
      );
      setScheduledAnnouncements((previous) => [...previous, data.post].sort((left, right) => new Date(left.scheduledAt) - new Date(right.scheduledAt)));
      setAnnouncementDraft({ content: '', scheduledAt: '', recurrence: 'once' });
    } catch (error) {
      setAnnouncementError(error.response?.data?.message || 'Could not schedule this announcement.');
    } finally {
      setAnnouncementSaving(false);
    }
  };

  const cancelScheduledAnnouncement = async (postId) => {
    const chat = selectedChatRef.current;
    if (!chat) return;
    try {
      await axios.delete(
        `${API_URL}/api/groups/${chat._id}/channels/${chat.channelId}/scheduled-posts/${postId}`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }, withCredentials: true }
      );
      setScheduledAnnouncements((previous) => previous.filter((post) => String(post.id) !== String(postId)));
    } catch (error) {
      setAnnouncementError(error.response?.data?.message || 'Could not cancel this announcement.');
    }
  };

  const submitScheduledMessage = async (event) => {
    event.preventDefault();
    const chat = selectedChatRef.current;
    if (!chat || !msg.trim() || !scheduledMessageAt || scheduledMessageSaving) return;
    if (selectedFiles.length || voiceFile || chat.groupType === 'community' && communityComposerType !== 'message') {
      setScheduledMessageError('Scheduled messages currently support text only.');
      return;
    }
    setScheduledMessageSaving(true);
    setScheduledMessageError('');
    try {
      const request = editingScheduledMessageId ? axios.put : axios.post;
      const url = editingScheduledMessageId
        ? `${API_URL}/api/scheduled-messages/${editingScheduledMessageId}`
        : `${API_URL}/api/scheduled-messages`;
      const payload = editingScheduledMessageId
        ? { content: msg.trim(), scheduledAt: new Date(scheduledMessageAt).toISOString() }
        : {
          conversationType: chat.type === 'group' ? 'group' : 'direct',
          conversationId: chat._id,
          ...(chat.type === 'group' && chat.channelId ? { channelId: chat.channelId } : {}),
          content: msg.trim(),
          scheduledAt: new Date(scheduledMessageAt).toISOString(),
        };
      const { data } = await request(url, payload, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        withCredentials: true,
      });
      const scheduled = data.message;
      setScheduledMessages((previous) => {
        const next = editingScheduledMessageId
          ? previous.map((item) => String(item.id) === String(editingScheduledMessageId) ? scheduled : item)
          : [...previous, scheduled];
        return next.sort((left, right) => new Date(left.scheduledAt) - new Date(right.scheduledAt));
      });
      setMsg('');
      setScheduledMessageAt('');
      setEditingScheduledMessageId(null);
    } catch (error) {
      setScheduledMessageError(error.response?.data?.message || 'Could not schedule this message.');
    } finally {
      setScheduledMessageSaving(false);
    }
  };

  const editScheduledMessage = (message) => {
    const localDate = new Date(message.scheduledAt);
    localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
    setMsg(message.content);
    setScheduledMessageAt(localDate.toISOString().slice(0, 16));
    setEditingScheduledMessageId(message.id);
    setScheduledMessagesOpen(true);
    setScheduledMessageError('');
  };

  const cancelScheduledMessage = async (messageId) => {
    try {
      await axios.delete(`${API_URL}/api/scheduled-messages/${messageId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        withCredentials: true,
      });
      setScheduledMessages((previous) => previous.filter((message) => String(message.id) !== String(messageId)));
      if (String(editingScheduledMessageId) === String(messageId)) {
        setEditingScheduledMessageId(null);
        setScheduledMessageAt('');
      }
    } catch (error) {
      setScheduledMessageError(error.response?.data?.message || 'Could not cancel this scheduled message.');
    }
  };

  const toggleMessageReaction = async (message, emoji) => {
    const chat = selectedChatRef.current;
    if (!chat?._id) return;
    setOpenReactionPicker(null);
    try {
      const { data } = await axios.post(
        chat.type === 'group'
          ? `${API_URL}/api/groups/${chat._id}/messages/${message._id}/reactions`
          : `${API_URL}/api/messages/${message._id}/reactions`,
        { emoji },
        { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }, withCredentials: true }
      );
      setMessages((previous) => previous.map((item) => String(item._id) === String(message._id)
        ? { ...item, reactions: data.reactions }
        : item));
    } catch (error) {
      window.alert(error.response?.data?.message || 'Could not update this reaction.');
    }
  };

  const setAcceptedAnswer = async (question, answerId) => {
    const chat = selectedChatRef.current;
    if (chat?.type !== 'group') return;
    try {
      const { data } = await axios.patch(
        `${API_URL}/api/groups/${chat._id}/messages/${question._id}/accepted-answer`,
        { answerId },
        { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }, withCredentials: true }
      );
      setMessages((previous) => previous.map((item) => String(item._id) === String(question._id)
        ? { ...item, ...data }
        : item));
      setActiveThread((current) => current && String(current._id) === String(question._id)
        ? { ...current, ...data }
        : current);
    } catch (error) {
      window.alert(error.response?.data?.message || 'Could not mark that answer.');
    }
  };

  const loadSavedMessages = async () => {
    setSavedMessagesLoading(true);
    try {
      const { data } = await axios.get(`${API_URL}/api/saved-messages`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        withCredentials: true,
      });
      setSavedMessages(data.messages || []);
    } catch (error) {
      window.alert(error.response?.data?.message || 'Could not load saved messages.');
    } finally {
      setSavedMessagesLoading(false);
    }
  };

  const loadCommunityReputation = async () => {
    const chat = selectedChatRef.current;
    if (chat?.type !== 'group' || chat.groupType !== 'community') return;
    setReputationOpen(true);
    setReputationLoading(true);
    setReputationError('');
    try {
      const { data } = await axios.get(`${API_URL}/api/groups/${chat._id}/reputation`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        withCredentials: true,
      });
      setReputationData(data);
    } catch (error) {
      setReputationError(error.response?.data?.message || 'Could not load community contributions.');
    } finally {
      setReputationLoading(false);
    }
  };

  const loadCommunityTasks = async () => {
    const chat = selectedChatRef.current;
    if (chat?.type !== 'group' || chat.groupType !== 'community') return;
    setTasksOpen(true);
    setTasksLoading(true);
    setTasksError('');
    try {
      const { data } = await axios.get(`${API_URL}/api/groups/${chat._id}/tasks`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        withCredentials: true,
      });
      if (String(selectedChatRef.current?._id) === String(chat._id)) {
        setCommunityTasks(data.tasks || []);
        setTaskMembers(data.members || []);
      }
    } catch (error) {
      setTasksError(error.response?.data?.message || 'Could not load community tasks.');
    } finally {
      setTasksLoading(false);
    }
  };

  const createCommunityTask = async (event) => {
    event.preventDefault();
    const chat = selectedChatRef.current;
    if (chat?.type !== 'group' || !taskDraft.title.trim()) return;
    setTasksError('');
    try {
      const { data } = await axios.post(`${API_URL}/api/groups/${chat._id}/tasks`, {
        channelId: chat.channelId || null,
        title: taskDraft.title.trim(),
        description: taskDraft.description.trim(),
        assignedTo: taskDraft.assignedTo || null,
        dueAt: taskDraft.dueAt ? new Date(taskDraft.dueAt).toISOString() : null,
        linkedMessageId: taskDraft.linkedMessageId || null,
      }, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        withCredentials: true,
      });
      setCommunityTasks((previous) => [data.task, ...previous]);
      setTaskDraft({ title: '', description: '', assignedTo: '', dueAt: '', linkedMessageId: '' });
    } catch (error) {
      setTasksError(error.response?.data?.message || 'Could not create this task.');
    }
  };

  const updateCommunityTask = async (task, changes) => {
    const chat = selectedChatRef.current;
    if (chat?.type !== 'group') return;
    const payload = { ...changes };
    if (Object.hasOwn(payload, 'assignedTo')) payload.assignedTo = payload.assignedTo || null;
    if (Object.hasOwn(payload, 'dueAt')) payload.dueAt = payload.dueAt ? new Date(payload.dueAt).toISOString() : null;
    if (Object.hasOwn(payload, 'linkedMessageId')) payload.linkedMessageId = payload.linkedMessageId || null;
    try {
      const { data } = await axios.patch(`${API_URL}/api/groups/${chat._id}/tasks/${task.id}`, payload, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        withCredentials: true,
      });
      setCommunityTasks((previous) => previous.map((item) => String(item.id) === String(task.id) ? data.task : item));
    } catch (error) {
      setTasksError(error.response?.data?.message || 'Could not update this task.');
    }
  };

  const deleteCommunityTask = async (taskId) => {
    const chat = selectedChatRef.current;
    if (chat?.type !== 'group') return;
    try {
      await axios.delete(`${API_URL}/api/groups/${chat._id}/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        withCredentials: true,
      });
      setCommunityTasks((previous) => previous.filter((task) => String(task.id) !== String(taskId)));
    } catch (error) {
      setTasksError(error.response?.data?.message || 'Could not delete this task.');
    }
  };

  const openTaskDiscussion = (task) => {
    if (!task.linkedMessageId || !task.channelId) return;
    const chat = selectedChatRef.current;
    const target = {
      _id: task.linkedMessageId,
      messageType: 'group',
      groupId: chat._id,
      channelId: task.channelId,
    };
    pendingSearchTargetRef.current = target;
    if (String(chat.channelId || '') !== String(task.channelId)) {
      onSelectChat({ ...chat, channelId: task.channelId, channelName: task.channelName });
    } else {
      setMessagesAttempt((attempt) => attempt + 1);
    }
    setTasksOpen(false);
  };

  const toggleSavedMessage = async (message, savedType = selectedChatRef.current?.type === 'group' ? 'group' : 'direct') => {
    const messageType = savedType;
    const key = `${messageType}:${message._id}`;
    const isSaved = savedMessages.some((item) => `${item.messageType}:${item._id}` === key);
    try {
      const endpoint = `${API_URL}/api/saved-messages/${messageType}/${message._id}`;
      if (isSaved) {
        await axios.delete(endpoint, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
          withCredentials: true,
        });
        setSavedMessages((previous) => previous.filter((item) => `${item.messageType}:${item._id}` !== key));
      } else {
        await axios.put(endpoint, {}, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
          withCredentials: true,
        });
        await loadSavedMessages();
      }
      setOpenMessageMenu(null);
    } catch (error) {
      window.alert(error.response?.data?.message || 'Could not update saved messages.');
    }
  };

  const openSavedConversation = (message) => {
    if (message.messageType === 'group') {
      onSelectChat({
        _id: message.groupId,
        name: message.groupName,
        type: 'group',
        groupType: message.groupType,
        ...(message.channelId ? { channelId: message.channelId, channelName: message.channelName } : {}),
      });
    } else {
      onSelectChat({ _id: message.conversationId, username: message.conversationName, type: 'direct' });
    }
    setSavedMessagesOpen(false);
  };

  const submitGlobalSearch = async (event) => {
    event.preventDefault();
    if (globalSearchQuery.trim().length < 2 || globalSearchLoading) return;
    setGlobalSearchLoading(true);
    setGlobalSearchError('');
    try {
      const { data } = await axios.get(`${API_URL}/api/search`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        params: {
          q: globalSearchQuery.trim(),
          filter: globalSearchFilter,
          ...(globalSearchFrom ? { from: globalSearchFrom } : {}),
          ...(globalSearchTo ? { to: globalSearchTo } : {}),
        },
        withCredentials: true,
      });
      setGlobalSearchResults(data.results || []);
    } catch (error) {
      setGlobalSearchError(error.response?.data?.message || 'Could not search conversations.');
      setGlobalSearchResults([]);
    } finally {
      setGlobalSearchLoading(false);
    }
  };

  const openGlobalSearchResult = (result) => {
    setGlobalSearchOpen(false);
    if (result.resultType === 'person') {
      pendingSearchTargetRef.current = null;
      onSelectChat({ _id: result._id, username: result.username, profilePicture: result.profilePicture, googlePicture: result.googlePicture, type: 'direct' });
      return;
    }
    pendingSearchTargetRef.current = result;
    const target = result.messageType === 'group'
      ? {
        _id: result.groupId,
        name: result.groupName,
        type: 'group',
        groupType: result.groupType,
        ...(result.channelId ? { channelId: result.channelId, channelName: result.channelName } : {}),
      }
      : { _id: result.conversationId, username: result.conversationName, type: 'direct' };
    const sameChat = String(selectedChatRef.current?._id) === String(target._id)
      && selectedChatRef.current?.type === target.type
      && String(selectedChatRef.current?.channelId || '') === String(target.channelId || '');
    onSelectChat(target);
    if (sameChat) setMessagesAttempt((attempt) => attempt + 1);
  };

  const sendSticker = (sticker) => {
    if (!selectedChat || !Socket.connected) return;
    const payload = { content: '', stickerId: sticker._id };
    Socket.emit(selectedChat.type === 'group' ? 'group-message' : 'send-message', selectedChat.type === 'group'
      ? { ...payload, groupId: selectedChat._id, ...(selectedChat.channelId ? { channelId: selectedChat.channelId } : {}) }
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
    await Promise.all(selectedMessages.map((message) => deleteMessage(message)));
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

  const isCommunityChat = selectedChat?.type === 'group' && selectedChat.groupType === 'community';
  const isAnnouncementChannel = isCommunityChat && selectedChat.channelName?.toLowerCase() === 'announcements';
  useEffect(() => {
    setAnnouncementError('');
    if (!isAnnouncementChannel || !selectedChat?._id || !selectedChat?.channelId) {
      setScheduledAnnouncements([]);
      return undefined;
    }
    let active = true;
    axios.get(`${API_URL}/api/groups/${selectedChat._id}/channels/${selectedChat.channelId}/scheduled-posts`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      withCredentials: true,
    }).then(({ data }) => {
      if (active) setScheduledAnnouncements(data.posts || []);
    }).catch((error) => {
      if (active) setAnnouncementError(error.response?.data?.message || 'Could not load scheduled announcements.');
    });
    return () => { active = false; };
  }, [isAnnouncementChannel, selectedChat?._id, selectedChat?.channelId]);
  const isStructuredComposer = isCommunityChat && ['poll', 'event'].includes(communityComposerType);
  const canPostToCommunityChannel = !isCommunityChat || (typeof selectedChat.channelCanPost === 'boolean'
    ? selectedChat.channelCanPost
    : selectedChat.channelPostingMode !== 'admins' || selectedChat.role === 'admin' || user?.role === 'admin');
  const composerCanSend = isCommunityChat
    ? communityComposerType === 'poll'
      ? Boolean(pollDraft.question.trim() && pollDraft.options.filter((option) => option.trim()).length >= 2)
      : communityComposerType === 'event'
        ? Boolean(eventDraft.title.trim() && eventDraft.startsAt)
        : Boolean(msg.trim())
    : Boolean(msg.trim());
  const forumFilterActive = communityPostFilter !== 'all'
    || communityCategoryFilter !== 'all'
    || Boolean(communityTagFilter.trim());
  const visibleMessages = isCommunityChat && forumFilterActive
    ? messages.filter((message) => {
      if (message.messageType !== 'question') return false;
      const solved = Boolean(message.acceptedAnswerId);
      if (communityPostFilter === 'unsolved' && solved) return false;
      if (communityPostFilter === 'solved' && !solved) return false;
      const data = message.structuredData || {};
      if (communityCategoryFilter !== 'all' && data.category !== communityCategoryFilter) return false;
      const tagNeedle = communityTagFilter.trim().toLowerCase().replace(/^#/, '');
      return !tagNeedle || (data.tags || []).some((tag) => String(tag).includes(tagNeedle));
    }).sort((left, right) => {
      if (communityPostSort === 'solved') return Number(Boolean(right.acceptedAnswerId)) - Number(Boolean(left.acceptedAnswerId));
      if (communityPostSort === 'discussion') {
        const leftReplies = messages.filter((message) => String(message.replyToId) === String(left._id)).length;
        const rightReplies = messages.filter((message) => String(message.replyToId) === String(right._id)).length;
        if (rightReplies !== leftReplies) return rightReplies - leftReplies;
      }
      return new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
    })
    : messages;
  const savedMessageKeys = new Set(savedMessages.map((message) => `${message.messageType}:${message._id}`));

  return (
    <div style={{ height: 'var(--app-height, 100dvh)', width: 'var(--app-width, 100vw)' }} className="theme-page flex h-screen w-screen overflow-hidden">
      <Sidebar
        isOpen={isSidebarOpen}
        isDesktopPanelOpen={isDesktopPanelOpen}
        onToggleDesktopPanel={() => setIsDesktopPanelOpen((open) => !open)}
        toggleSidebar={toggleSidebar}
        onCloseSidebar={closeSidebar}
        onSelectChat={onSelectChat}
        onOpenAdmin={() => setIsAdminOpen(true)}
        user={user}
        onUserUpdated={onUserUpdated}
        theme={theme}
        onToggleTheme={onToggleTheme}
        accent={accent}
        onChangeAccent={onChangeAccent}
        selectedChat={selectedChat}
        conversationMuted={conversationMuted}
        conversationMuteLoading={conversationMuteLoading}
        conversationMuteSaving={conversationMuteSaving}
        conversationMuteError={conversationMuteError}
        onToggleConversationMute={toggleConversationMute}
      />


      <div
        className={`relative ml-0 flex min-h-0 min-w-0 flex-1 flex-col transition-all duration-300 ease-in-out ${isDesktopPanelOpen ? 'sm:ml-[22rem]' : 'sm:ml-16'}`}
      >
        {/* Header */}
        <header className="theme-header relative z-30 flex w-full shrink-0 items-center justify-between gap-2 rounded-b-2xl border py-3 pl-[max(4rem,calc(3rem+env(safe-area-inset-left)))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[max(0.75rem,env(safe-area-inset-top))] shadow-lg sm:py-4 sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]">
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
            {selectedChat?.type === 'group' && (selectedChat.channelName || selectedChat.members != null) && (
              <p className="theme-muted mt-0.5 text-xs">
                {selectedChat.channelName ? `# ${selectedChat.channelName}` : `${selectedChat.members} members · ${selectedChat.role}`}
              </p>
            )}
          </div>
          <div className="relative flex shrink-0 items-center justify-end gap-1 sm:gap-4">
            {isSelectionMode ? (
              <>
                <button
                  type="button"
                  ref={bulkPanel.triggerRef}
                  onClick={() => setOpenBulkMenu((current) => !current)}
                  className="chat-action theme-text grid h-10 w-10 place-items-center rounded-xl border"
                  title="Selected message actions"
                  aria-label="Selected message actions"
                >
                  <FaEllipsisV />
                </button>
                <FloatingPanel open={openBulkMenu} panelRef={bulkPanel.panelRef} style={bulkPanel.style} className="min-w-40 rounded-lg border border-black/20 bg-slate-950 p-1 text-xs text-white shadow-xl">
                    <button type="button" onClick={deleteSelectedMessages} className="block w-full rounded px-2 py-2 text-left text-rose-300 hover:bg-white/10">
                      Delete selected
                    </button>
                    <button type="button" onClick={forwardSelectedMessages} className="block w-full rounded px-2 py-2 text-left hover:bg-white/10">
                      Forward selected
                    </button>
                    <button type="button" onClick={copySelectedMessages} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-white/10">
                      <FaCopy /> Copy selected
                    </button>
                </FloatingPanel>
              </>
            ) : (
              <>
            <button
              type="button"
              onClick={() => { setGlobalSearchOpen(true); setGlobalSearchError(''); }}
              title="Search conversations"
              aria-label="Search conversations"
              className="chat-action theme-text grid h-10 w-10 place-items-center rounded-xl border transition hover:text-accent-text"
            >
              <FaSearch />
            </button>
            <button
              type="button"
              onClick={() => { setSavedMessagesOpen(true); loadSavedMessages(); }}
              title="Saved messages"
              aria-label="Saved messages"
              className="chat-action theme-text grid h-10 w-10 place-items-center rounded-xl border transition hover:text-accent-text"
            >
              <FaStar />
            </button>
            {isCommunityChat && (
              <button
                type="button"
                onClick={loadCommunityReputation}
                title="Community contributions"
                aria-label="Community contributions"
                className="chat-action theme-text grid h-10 w-10 place-items-center rounded-xl border transition hover:text-accent-text"
              >
                <FaTrophy />
              </button>
            )}
            {isCommunityChat && (
              <button
                type="button"
                onClick={loadCommunityTasks}
                title="Community task board"
                aria-label="Community task board"
                className="chat-action theme-text grid h-10 w-10 place-items-center rounded-xl border transition hover:text-accent-text"
              >
                <FaTasks />
              </button>
            )}
            {isCommunityChat && (
              <button
                type="button"
                onClick={() => setWhiteboardOpen(true)}
                title="Community whiteboard"
                aria-label="Community whiteboard"
                className="chat-action theme-text grid h-10 w-10 place-items-center rounded-xl border transition hover:text-accent-text"
              >
                <FaPencilAlt />
              </button>
            )}
            {isCommunityChat && (
              <button
                type="button"
                onClick={() => setCodeRoomOpen(true)}
                title="Community code room"
                aria-label="Community code room"
                className="chat-action theme-text grid h-10 w-10 place-items-center rounded-xl border transition hover:text-accent-text"
              >
                <FaCode />
              </button>
            )}
            <NotificationCenter onNavigate={navigateToNotificationTarget} />
            <button
              onClick={() => { setCallType('audio'); setIsVideoOpen(true); }}
              title="Start Audio Call"
              disabled={!selectedChat || selectedChat.type === 'group'}
              aria-label="Start audio call"
              className="chat-action theme-text grid h-10 w-10 place-items-center rounded-xl border transition hover:text-accent-text disabled:opacity-30"
            >
              <FaPhone />
            </button>
            <button
              onClick={() => { setCallType('video'); setIsVideoOpen(true); }}
              title="Start Video Call"
              disabled={!selectedChat || selectedChat.type === 'group'}
              aria-label="Start video call"
              className="chat-action theme-text grid h-10 w-10 place-items-center rounded-xl border transition hover:text-accent-text disabled:opacity-30"
            >
              <FaVideo />
            </button>
              </>
            )}
          </div>
        </header>

        {savedMessagesOpen && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setSavedMessagesOpen(false); }}>
            <section role="dialog" aria-modal="true" aria-labelledby="saved-messages-title" className="glass-panel flex max-h-[min(80dvh,42rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-2xl">
              <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <h2 id="saved-messages-title" className="text-sm font-semibold">Saved messages</h2>
                <button type="button" onClick={() => setSavedMessagesOpen(false)} aria-label="Close saved messages" title="Close" className="grid h-8 w-8 place-items-center rounded hover:bg-white/10"><FaTimes /></button>
              </header>
              <div className="min-h-0 overflow-y-auto px-4">
                {savedMessagesLoading ? <p role="status" className="theme-muted py-8 text-center text-sm">Loading saved messages…</p>
                  : savedMessages.length === 0 ? <p className="theme-muted py-8 text-center text-sm">No saved messages yet.</p>
                    : <ul className="divide-y divide-white/10">
                      {savedMessages.map((message) => (
                        <li key={`${message.messageType}:${message._id}`} className="flex min-w-0 items-center gap-3 py-3">
                          <button type="button" onClick={() => openSavedConversation(message)} className="min-w-0 flex-1 text-left hover:text-accent-text">
                            <span className="flex min-w-0 items-center gap-2 text-[11px] text-white/55">
                              <span className="truncate">{message.messageType === 'group'
                                ? `${message.groupName}${message.channelName ? ` · #${message.channelName}` : ''}`
                                : message.conversationName}</span>
                              <time className="shrink-0">{new Date(message.timestamp).toLocaleDateString()}</time>
                            </span>
                            <span className="mt-1 block line-clamp-2 break-words text-sm">{message.content || 'Attachment or media message'}</span>
                          </button>
                          <button type="button" onClick={() => toggleSavedMessage(message, message.messageType)} aria-label="Remove saved message" title="Remove saved message" className="grid h-8 w-8 shrink-0 place-items-center rounded text-accent-text hover:bg-accent-soft"><FaStar size={12} /></button>
                        </li>
                      ))}
                    </ul>}
              </div>
            </section>
          </div>
        )}

        {globalSearchOpen && (
          <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setGlobalSearchOpen(false); }}>
            <section role="dialog" aria-modal="true" aria-labelledby="global-search-title" className="glass-panel flex max-h-[min(84dvh,48rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border shadow-2xl">
              <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <h2 id="global-search-title" className="text-sm font-semibold">Search conversations</h2>
                <button type="button" onClick={() => setGlobalSearchOpen(false)} aria-label="Close search" title="Close search" className="grid h-8 w-8 place-items-center rounded hover:bg-white/10"><FaTimes /></button>
              </header>
              <form onSubmit={submitGlobalSearch} className="grid gap-2 border-b border-white/10 p-3 sm:grid-cols-[minmax(12rem,1fr)_auto_auto_auto_auto]">
                <input
                  autoFocus
                  type="search"
                  minLength={2}
                  maxLength={120}
                  value={globalSearchQuery}
                  onChange={(event) => setGlobalSearchQuery(event.target.value)}
                  placeholder="Search messages, files, people, links"
                  aria-label="Search query"
                  className="min-w-0 rounded border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-accent-border"
                />
                <select value={globalSearchFilter} onChange={(event) => setGlobalSearchFilter(event.target.value)} aria-label="Search filter" className="rounded border border-white/10 bg-slate-900 px-2 py-2 text-xs">
                  <option value="all">All</option>
                  <option value="messages">Messages</option>
                  <option value="files">Files</option>
                  <option value="links">Links</option>
                  <option value="people">People</option>
                  <option value="direct">Direct</option>
                  <option value="group">Groups</option>
                </select>
                <input type="date" value={globalSearchFrom} onChange={(event) => setGlobalSearchFrom(event.target.value)} aria-label="From date" className="min-w-0 rounded border border-white/10 bg-slate-900 px-2 py-2 text-xs" />
                <input type="date" value={globalSearchTo} onChange={(event) => setGlobalSearchTo(event.target.value)} aria-label="To date" className="min-w-0 rounded border border-white/10 bg-slate-900 px-2 py-2 text-xs" />
                <button type="submit" disabled={globalSearchQuery.trim().length < 2 || globalSearchLoading} className="inline-flex items-center justify-center gap-2 rounded bg-accent px-3 py-2 text-xs font-semibold text-accent-contrast disabled:opacity-40">
                  <FaSearch /> Search
                </button>
              </form>
              {globalSearchError && <p role="alert" className="px-4 pt-3 text-xs text-rose-200">{globalSearchError}</p>}
              <div className="min-h-0 flex-1 overflow-y-auto px-4">
                {globalSearchLoading ? <p role="status" className="theme-muted py-8 text-center text-sm">Searching…</p>
                  : globalSearchResults.length === 0 ? <p className="theme-muted py-8 text-center text-sm">{globalSearchQuery.trim().length < 2 ? 'Enter at least 2 characters to search.' : 'No results found.'}</p>
                    : <ul className="divide-y divide-white/10">
                      {globalSearchResults.map((result) => {
                        const attachments = typeof result.attachments === 'string'
                          ? (() => { try { return JSON.parse(result.attachments); } catch { return []; } })()
                          : result.attachments;
                        const attachmentNames = Array.isArray(attachments) ? attachments.map((attachment) => attachment?.name).filter(Boolean).join(', ') : '';
                        const title = result.resultType === 'person'
                          ? result.username
                          : result.content || attachmentNames || 'Attachment or media message';
                        const conversation = result.resultType === 'person'
                          ? 'Person'
                          : result.messageType === 'group'
                            ? `${result.groupName}${result.channelName ? ` · #${result.channelName}` : ''}`
                            : result.conversationName;
                        return (
                          <li key={`${result.resultType}:${result.messageType || 'person'}:${result._id}`}>
                            <button type="button" onClick={() => openGlobalSearchResult(result)} className="block w-full min-w-0 py-3 text-left hover:text-accent-text">
                              <span className="flex min-w-0 items-center gap-2 text-[11px] text-white/55">
                                <span className="truncate">{conversation}</span>
                                {result.senderName && <span className="shrink-0">{result.senderName}</span>}
                                {result.timestamp && <time className="ml-auto shrink-0">{new Date(result.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</time>}
                              </span>
                              <span className="mt-1 block line-clamp-2 break-words text-sm">{title}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>}
              </div>
            </section>
          </div>
        )}

        {reputationOpen && (
          <div className="fixed inset-0 z-[96] flex items-center justify-center bg-black/60 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setReputationOpen(false); }}>
            <section role="dialog" aria-modal="true" aria-labelledby="community-reputation-title" className="glass-panel flex max-h-[min(84dvh,48rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border shadow-2xl">
              <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div>
                  <h2 id="community-reputation-title" className="text-sm font-semibold">Community contributions</h2>
                  {reputationData?.me && <p className="theme-muted mt-0.5 text-xs">Your score · {reputationData.me.points} points{reputationData.me.rank ? ` · rank ${reputationData.me.rank}` : ''}</p>}
                </div>
                <button type="button" onClick={() => setReputationOpen(false)} aria-label="Close contributions" title="Close" className="grid h-8 w-8 place-items-center rounded hover:bg-white/10"><FaTimes /></button>
              </header>
              {reputationError && <p role="alert" className="px-4 pt-3 text-xs text-rose-200">{reputationError}</p>}
              {reputationLoading ? <p role="status" className="theme-muted py-10 text-center text-sm">Loading contributions…</p>
                : <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[minmax(0,1.3fr)_minmax(14rem,0.7fr)]">
                  <section aria-label="Community leaderboard">
                    <h3 className="mb-2 text-xs font-semibold uppercase text-white/55">Leaderboard</h3>
                    <ol className="divide-y divide-white/10">
                      {(reputationData?.leaderboard || []).map((member) => (
                        <li key={member.userId} className="flex min-w-0 items-center gap-3 py-2">
                          <span className="w-7 shrink-0 text-right text-xs tabular-nums text-white/45">{member.rank}</span>
                          <span className="min-w-0 flex-1 truncate text-sm">{member.username}{String(member.userId) === String(user?._id) ? ' · you' : ''}</span>
                          <span className="shrink-0 text-xs tabular-nums text-accent-text">{member.points} pts</span>
                          <span className="hidden min-w-20 text-right text-[10px] text-accent-text sm:inline">{member.badges.join(' · ')}</span>
                        </li>
                      ))}
                    </ol>
                    {!reputationLoading && !reputationData?.leaderboard?.length && <p className="theme-muted py-6 text-center text-xs">No contributions yet.</p>}
                  </section>
                  <section aria-label="Your contribution history">
                    <h3 className="mb-2 text-xs font-semibold uppercase text-white/55">Your recent history</h3>
                    <ul className="divide-y divide-white/10">
                      {(reputationData?.history || []).map((item) => (
                        <li key={`${item.eventType}:${item.sourceId}`} className="flex items-center justify-between gap-2 py-2 text-xs">
                          <span className="min-w-0 truncate text-white/75">{{
                            post: 'Community post',
                            helpful_reaction: 'Helpful post',
                            accepted_answer: 'Accepted answer',
                          }[item.eventType] || 'Contribution'}</span>
                          <span className="shrink-0 text-accent-text">+{item.points}</span>
                        </li>
                      ))}
                    </ul>
                    {!reputationData?.history?.length && <p className="theme-muted py-6 text-xs">Your activity will appear here.</p>}
                  </section>
                </div>}
            </section>
          </div>
        )}

        {tasksOpen && (
          <div className="fixed inset-0 z-[97] flex items-center justify-center bg-black/60 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setTasksOpen(false); }}>
            <section role="dialog" aria-modal="true" aria-labelledby="community-tasks-title" className="glass-panel flex max-h-[min(88dvh,52rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border shadow-2xl">
              <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div>
                  <h2 id="community-tasks-title" className="text-sm font-semibold">{selectedChat?.name || 'Community'} tasks</h2>
                  <p className="theme-muted mt-0.5 text-xs">{communityTasks.length} tasks</p>
                </div>
                <button type="button" onClick={() => setTasksOpen(false)} aria-label="Close task board" title="Close" className="grid h-8 w-8 place-items-center rounded hover:bg-white/10"><FaTimes /></button>
              </header>
              {tasksError && <p role="alert" className="px-4 pt-3 text-xs text-rose-200">{tasksError}</p>}
              <form onSubmit={createCommunityTask} className="grid gap-2 border-b border-white/10 p-3 sm:grid-cols-2">
                <input value={taskDraft.title} onChange={(event) => setTaskDraft((draft) => ({ ...draft, title: event.target.value }))} maxLength={160} placeholder="Task title" aria-label="Task title" className="min-w-0 rounded border border-white/10 bg-black/20 px-3 py-2 text-sm" />
                <div className="grid grid-cols-2 gap-2">
                  <select value={taskDraft.assignedTo} onChange={(event) => setTaskDraft((draft) => ({ ...draft, assignedTo: event.target.value }))} aria-label="Assign task to" className="min-w-0 rounded border border-white/10 bg-slate-900 px-2 py-2 text-xs">
                    <option value="">Unassigned</option>
                    {taskMembers.map((member) => <option key={member.id} value={member.id}>{member.username}</option>)}
                  </select>
                  <input type="datetime-local" value={taskDraft.dueAt} onChange={(event) => setTaskDraft((draft) => ({ ...draft, dueAt: event.target.value }))} aria-label="Task deadline" className="min-w-0 rounded border border-white/10 bg-slate-900 px-2 py-2 text-xs" />
                </div>
                <textarea value={taskDraft.description} onChange={(event) => setTaskDraft((draft) => ({ ...draft, description: event.target.value }))} maxLength={3000} rows={2} placeholder="Description" aria-label="Task description" className="min-w-0 resize-y rounded border border-white/10 bg-black/20 px-3 py-2 text-xs sm:col-span-2" />
                <div className="flex min-w-0 gap-2 sm:col-span-2">
                  <select value={taskDraft.linkedMessageId} onChange={(event) => setTaskDraft((draft) => ({ ...draft, linkedMessageId: event.target.value }))} aria-label="Link a discussion message" className="min-w-0 flex-1 rounded border border-white/10 bg-slate-900 px-2 py-2 text-xs">
                    <option value="">No linked discussion</option>
                    {messages.filter((message) => !message.isDeleted).map((message) => <option key={message._id} value={message._id}>{String(message.content || 'Attachment').slice(0, 100)}</option>)}
                  </select>
                  <button type="submit" disabled={!taskDraft.title.trim()} className="shrink-0 rounded bg-accent px-3 py-2 text-xs font-semibold text-accent-contrast disabled:opacity-40">Create task</button>
                </div>
              </form>
              <div className="min-h-0 flex-1 overflow-y-auto px-4">
                {tasksLoading ? <p role="status" className="theme-muted py-8 text-center text-sm">Loading tasks…</p>
                  : communityTasks.length === 0 ? <p className="theme-muted py-8 text-center text-sm">No tasks yet.</p>
                    : <ul className="divide-y divide-white/10">
                      {communityTasks.map((task) => {
                        const localDue = task.dueAt ? new Date(task.dueAt) : null;
                        if (localDue) localDue.setMinutes(localDue.getMinutes() - localDue.getTimezoneOffset());
                        return (
                          <li key={task.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                            <div className="min-w-0">
                              <p className="break-words text-sm font-medium">{task.title}</p>
                              {task.description && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-white/65">{task.description}</p>}
                              <p className="mt-1 text-[10px] text-white/40">Created by {task.creatorName}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                              <select value={task.status} onChange={(event) => updateCommunityTask(task, { status: event.target.value })} aria-label={`Status for ${task.title}`} className="rounded border border-white/10 bg-slate-900 px-2 py-1.5 text-[11px]">
                                <option value="todo">To do</option>
                                <option value="in_progress">In progress</option>
                                <option value="done">Done</option>
                              </select>
                              <select value={task.assignedTo || ''} onChange={(event) => updateCommunityTask(task, { assignedTo: event.target.value })} aria-label={`Assignee for ${task.title}`} className="max-w-32 rounded border border-white/10 bg-slate-900 px-2 py-1.5 text-[11px]">
                                <option value="">Unassigned</option>
                                {taskMembers.map((member) => <option key={member.id} value={member.id}>{member.username}</option>)}
                              </select>
                              <input type="datetime-local" value={localDue ? localDue.toISOString().slice(0, 16) : ''} onChange={(event) => updateCommunityTask(task, { dueAt: event.target.value })} aria-label={`Deadline for ${task.title}`} className="max-w-40 rounded border border-white/10 bg-slate-900 px-2 py-1.5 text-[10px]" />
                              {task.linkedMessageId && <button type="button" onClick={() => openTaskDiscussion(task)} className="rounded px-2 py-1.5 text-[11px] text-accent-text hover:bg-white/10">Open discussion</button>}
                              <button type="button" onClick={() => deleteCommunityTask(task.id)} aria-label={`Delete ${task.title}`} title="Delete task" className="grid h-7 w-7 place-items-center rounded text-white/45 hover:bg-white/10 hover:text-rose-200"><FaTimes size={10} /></button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>}
              </div>
            </section>
          </div>
        )}

        {whiteboardOpen && selectedChat?.type === 'group' && (
          <CommunityWhiteboard groupId={selectedChat._id} onClose={() => setWhiteboardOpen(false)} />
        )}
        {codeRoomOpen && selectedChat?.type === 'group' && (
          <Suspense fallback={<div role="status" className="fixed inset-0 z-[99] grid place-items-center bg-black/70 text-sm text-white">Loading code room…</div>}>
            <CommunityCodeRoom groupId={selectedChat._id} groupName={selectedChat.name} userName={user?.username} onClose={() => setCodeRoomOpen(false)} />
          </Suspense>
        )}

        <div id="chat-area-overlay" className="pointer-events-none absolute inset-0 z-[65]" />
        <div id="chat-area-settings" className="pointer-events-none absolute inset-x-0 bottom-0 top-16 z-[25] overflow-y-auto" />

        {/* Main chat area */}
        <main
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          style={{ paddingBottom: `${footerHeight + 16}px` }}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-4 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:py-6 sm:pl-[max(2rem,env(safe-area-inset-left))] sm:pr-[max(2rem,env(safe-area-inset-right))]"
        >
          <div className="chat-content-panel glass-panel mx-auto flex min-h-full w-full max-w-5xl flex-col space-y-3 rounded-2xl p-3 sm:p-5">
            {!selectedChat && <div className="flex h-full min-h-[55vh] flex-col items-center justify-center text-center">
              <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-accent-border bg-accent-soft text-accent-text"><FaUsers size={25} /></div>
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
            {isCommunityChat && (
              <section className="mb-3 rounded-lg border border-white/10 bg-black/10 p-2.5" aria-label="Forum question filters">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor="community-question-status">Question status</label>
                  <select id="community-question-status" value={communityPostFilter} onChange={(event) => setCommunityPostFilter(event.target.value)} className="rounded border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-white">
                    <option value="all">All posts</option>
                    <option value="questions">Questions</option>
                    <option value="unsolved">Unsolved</option>
                    <option value="solved">Solved</option>
                  </select>
                  <label className="sr-only" htmlFor="community-question-category">Category</label>
                  <select id="community-question-category" value={communityCategoryFilter} onChange={(event) => setCommunityCategoryFilter(event.target.value)} className="rounded border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-white">
                    <option value="all">All categories</option>
                    {COMMUNITY_QUESTION_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                  <label className="sr-only" htmlFor="community-question-sort">Sort questions</label>
                  <select id="community-question-sort" value={communityPostSort} onChange={(event) => setCommunityPostSort(event.target.value)} className="rounded border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-white">
                    <option value="newest">Newest</option>
                    <option value="discussion">Most discussed</option>
                    <option value="solved">Solved first</option>
                  </select>
                  <label className="relative min-w-[8rem] flex-1 sm:max-w-52">
                    <FaHashtag className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-white/40" />
                    <input value={communityTagFilter} onChange={(event) => setCommunityTagFilter(event.target.value)} aria-label="Filter by tag" placeholder="Filter by tag" className="w-full rounded border border-white/10 bg-slate-900 py-1.5 pl-7 pr-2 text-xs text-white placeholder:text-white/40" />
                  </label>
                </div>
              </section>
            )}
            {selectedChat && visibleMessages.map((m) => (
              <div
                key={m._id}
                className={`message-row relative flex w-full min-w-0 touch-pan-y ${String(m.sender) === String(user?._id) ? 'justify-end' : 'justify-start'} ${highlightedMessageId === String(m._id) ? 'message-reply-highlight' : ''}`}
                style={{
                  transform: `translate3d(${replySwipe.messageId === String(m._id) ? replySwipe.offset : 0}px, 0, 0)`,
                  transition: replySwipe.messageId === String(m._id) && replySwipe.dragging ? 'none' : 'transform 180ms ease-out',
                }}
                onClick={() => {
                  if (suppressMessageClick.current) {
                    suppressMessageClick.current = false;
                    return;
                  }
                  if (isSelectionMode) toggleMessageSelection(m._id);
                }}
                onPointerDown={(event) => {
                  if (isSelectionMode) return;
                  if (event.pointerType === 'mouse') return;
                  if (replyDrag.current?.timer) window.clearTimeout(replyDrag.current.timer);
                  const gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, timer: null };
                  gesture.timer = window.setTimeout(() => {
                    if (replyDrag.current !== gesture) return;
                    replyDrag.current = null;
                    suppressMessageClick.current = true;
                    setIsSelectionMode(true);
                    setSelectedMessageIds([String(m._id)]);
                    setOpenMessageMenu(null);
                    setOpenBulkMenu(false);
                    setReplySwipe({ messageId: String(m._id), offset: 0, dragging: false });
                  }, 500);
                  replyDrag.current = gesture;
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const start = replyDrag.current;
                  if (!start || isSelectionMode) return;
                  const signedDeltaX = event.clientX - start.x;
                  const deltaX = Math.abs(signedDeltaX);
                  const deltaY = Math.abs(event.clientY - start.y);
                  if (deltaX > 12 || deltaY > 12) {
                    start.moved = true;
                    if (start.timer) {
                      window.clearTimeout(start.timer);
                      start.timer = null;
                    }
                  }
                  if (deltaX > 12 && deltaX > deltaY) {
                    event.preventDefault();
                    setReplySwipe({ messageId: String(m._id), offset: Math.max(-88, Math.min(88, signedDeltaX)), dragging: true });
                  }
                }}
                onPointerUp={(event) => {
                  const start = replyDrag.current;
                  replyDrag.current = null;
                  if (start?.timer) window.clearTimeout(start.timer);
                  const deltaX = start ? event.clientX - start.x : 0;
                  const deltaY = start ? event.clientY - start.y : 0;
                  if (!isSelectionMode && start?.moved && Math.abs(deltaX) >= 70 && Math.abs(deltaX) > Math.abs(deltaY)) {
                    const replied = messages.find((candidate) => String(candidate._id) === String(m._id));
                    if (replied && !replied.isDeleted) setReplyTo(replied);
                  }
                  setReplySwipe({ messageId: String(m._id), offset: 0, dragging: false });
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => {
                  if (replyDrag.current?.timer) window.clearTimeout(replyDrag.current.timer);
                  replyDrag.current = null;
                  setReplySwipe({ messageId: String(m._id), offset: 0, dragging: false });
                }}
              >
                <div
                  data-message-id={m._id}
                  className={`relative max-w-[min(82%,34rem)] rounded-2xl pl-4 pr-10 py-2.5 text-sm shadow ${String(m.sender) === String(user?._id)
                    ? 'chat-bubble-own rounded-br-sm'
                    : 'chat-bubble-peer rounded-bl-sm'
                    }`}
                >
                  <button
                    type="button"
                    onClick={(event) => toggleMessageMenu(event, m._id)}
                    onPointerDown={(event) => event.stopPropagation()}
                    aria-label="Message actions"
                    title="Message actions"
                    className="absolute right-2 top-2 rounded-md p-1 opacity-60 transition hover:bg-black/20 hover:opacity-100"
                  >
                    <FaEllipsisV size={12} />
                  </button>
                  {openMessageMenu === String(m._id) && createPortal(
                    <div
                      ref={messageMenuRef}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                      style={{
                        position: 'fixed',
                        left: messageMenuPosition?.left ?? 0,
                        top: messageMenuPosition?.top ?? 0,
                        minWidth: messageMenuPosition ? Math.min(128, messageMenuPosition.maxWidth) : 'min(8rem, calc(100vw - 16px))',
                        maxWidth: messageMenuPosition?.maxWidth ?? 'calc(100vw - 16px)',
                        maxHeight: messageMenuPosition?.maxHeight ?? 'calc(100dvh - 16px)',
                        visibility: messageMenuPosition ? 'visible' : 'hidden',
                      }}
                      className="z-[100] overflow-y-auto rounded-lg border border-black/20 bg-slate-950 p-1 text-xs text-white shadow-xl"
                    >
                      {!m.isDeleted && (
                        <button type="button" onClick={() => { setReplyTo(m); setOpenMessageMenu(null); }} className="block w-full rounded px-2 py-1.5 text-left hover:bg-white/10">
                          Reply
                        </button>
                      )}
                      {!m.isDeleted && (
                        <button type="button" onClick={() => toggleSavedMessage(m)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-white/10">
                          <FaStar className="text-accent-text" />
                          {savedMessageKeys.has(`${selectedChat.type === 'group' ? 'group' : 'direct'}:${m._id}`) ? 'Remove saved message' : 'Save message'}
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
                      <button type="button" onClick={() => { setOpenMessageMenu(null); deleteMessage(m); }} className="block w-full rounded px-2 py-1.5 text-left text-rose-300 hover:bg-white/10">
                        {m.isDeleted
                          ? 'Remove from chat'
                          : String(m.sender) === String(user?._id) ? 'Delete for everyone' : 'Delete for me'}
                      </button>
                    </div>,
                    document.body,
                  )}
                  {selectedMessageIds.includes(String(m._id)) && (
                    <span className="absolute -left-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-accent text-[10px] font-bold text-accent-contrast">✓</span>
                  )}
                  {(selectedChat.type === 'group' || String(m.sender) !== String(user?._id)) && <p className={`mb-0.5 text-xs font-semibold ${String(m.sender) === String(user?._id) ? 'text-accent-text' : 'text-accent-deep'}`}>
                    {String(m.sender) === String(user?._id) ? 'You' : m.senderName || selectedChat.username}
                  </p>}
                  {selectedChat.type === 'group' && selectedChat.groupType === 'community' && !m.isDeleted
                    && ['question', 'poll', 'event'].includes(m.messageType) ? (
                      <CommunityPostCard
                        message={m}
                        threadCount={messages.filter((item) => String(item.replyToId) === String(m._id)).length}
                        onVote={voteInPoll}
                        onRsvp={respondToEvent}
                        onOpenThread={setActiveThread}
                      />
                    ) : m.content && (
                      selectedChat.type === 'group' && selectedChat.groupType === 'community'
                        ? <MarkdownMessage>{m.content}</MarkdownMessage>
                        : <p className={`whitespace-pre-wrap break-words ${m.isDeleted ? 'italic opacity-75' : ''}`}>{m.content}</p>
                    )}
                  {selectedChat.type === 'group' && selectedChat.groupType === 'community'
                    && !['question', 'poll', 'event'].includes(m.messageType) && (
                      <button type="button" onClick={() => setActiveThread(m)} className="mt-1 block text-[10px] text-sky-200/75 hover:text-white">
                        {messages.filter((item) => String(item.replyToId) === String(m._id)).length
                          ? `Open thread · ${messages.filter((item) => String(item.replyToId) === String(m._id)).length} replies`
                          : 'Start thread'}
                      </button>
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
                      className="mt-1 block text-xs text-accent-text underline"
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
                          className="flex min-w-0 max-w-[52%] cursor-pointer items-center gap-2 rounded-md border border-accent-border bg-slate-950/80 px-2 py-1.5 text-left text-xs text-accent-text shadow-inner"
                        >
                          <FaReply className="shrink-0 text-accent-text" />
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
                        <div className="max-w-full">
                          {attachment.duration && <span className="mb-1 block text-xs font-medium">Voice message · {Math.ceil(attachment.duration)}s</span>}
                          {attachment.url.startsWith('/api/voice-media/') ? (
                            <VoiceMessagePlayer
                              src={`${API_URL}${attachment.url}`}
                              mimeType={attachment.mimeType}
                              duration={attachment.duration}
                            />
                          ) : (
                            <audio controls preload="metadata" className="max-w-full">
                              <source src={`${API_URL}${attachment.url}`} type={attachment.mimeType} />
                              Your browser cannot play this audio.
                            </audio>
                          )}
                        </div>
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
                  {!m.isDeleted && (
                    <div className="mt-2 flex flex-wrap items-center gap-1" aria-label="Message reactions">
                      {(m.reactions || []).map((reaction) => (
                        <button
                          key={reaction.emoji}
                          type="button"
                          onClick={() => toggleMessageReaction(m, reaction.emoji)}
                          aria-label={`${reaction.emoji} reaction, ${reaction.count}`}
                          aria-pressed={reaction.reactedByMe}
                          title={`${reaction.count} reaction${reaction.count === 1 ? '' : 's'}`}
                          className={`inline-flex h-7 min-w-8 items-center justify-center gap-1 rounded-full border px-2 text-xs ${reaction.reactedByMe ? 'border-accent-border bg-accent/20 text-accent-text' : 'border-white/10 bg-white/[0.04] hover:bg-white/10'}`}
                        >
                          <span>{reaction.emoji}</span><span>{reaction.count}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setOpenReactionPicker((current) => current === String(m._id) ? null : String(m._id))}
                        aria-label="Add reaction"
                        aria-expanded={openReactionPicker === String(m._id)}
                        title="Add reaction"
                        className="grid h-7 w-7 place-items-center rounded-full border border-white/10 text-xs opacity-70 hover:bg-white/10 hover:opacity-100"
                      >
                        <FaSmile />
                      </button>
                      {openReactionPicker === String(m._id) && (
                        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-slate-950/95 p-1" role="group" aria-label="Choose a reaction">
                          {MESSAGE_REACTIONS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => toggleMessageReaction(m, emoji)}
                              aria-label={`React with ${emoji}`}
                              title={`React with ${emoji}`}
                              className="grid h-7 w-7 place-items-center rounded-full text-sm hover:bg-white/10"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <span className="chat-message-time mt-1 block text-right text-[10px]">
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
          style={{ '--desktop-sidebar-offset': isDesktopPanelOpen ? '22rem' : '4rem' }}
          className="theme-footer fixed inset-x-0 bottom-0 z-30 box-border w-full min-w-0 rounded-t-2xl border pt-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl sm:left-[var(--desktop-sidebar-offset)] sm:right-0 sm:w-[calc(100%-var(--desktop-sidebar-offset))] sm:py-4 sm:pl-[max(2rem,env(safe-area-inset-left))] sm:pr-[max(2rem,env(safe-area-inset-right))]"
        >
          {selectedChat && !socketConnected && (
            <p role="status" className="mx-auto mb-2 max-w-4xl text-xs text-amber-200">
              Reconnecting to chat… Messages will send when the connection is restored.
            </p>
          )}
          {isCommunityChat && !canPostToCommunityChannel && (
            <p role="status" className="mx-auto mb-2 max-w-4xl text-xs text-amber-200">Only community leaders can post in this channel.</p>
          )}
          {isAnnouncementChannel && (
            <section className="mx-auto mb-2 max-w-4xl space-y-2 border-b border-white/10 pb-2" aria-label="Scheduled announcements">
              <form onSubmit={scheduleAnnouncement} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                <input
                  value={announcementDraft.content}
                  onChange={(event) => setAnnouncementDraft((draft) => ({ ...draft, content: event.target.value }))}
                  maxLength={10000}
                  placeholder="Announcement text"
                  aria-label="Announcement text"
                  className="min-w-0 rounded border border-white/10 bg-black/20 px-3 py-2 text-xs text-white"
                  disabled={!canPostToCommunityChannel || announcementSaving}
                />
                <input
                  type="datetime-local"
                  value={announcementDraft.scheduledAt}
                  onChange={(event) => setAnnouncementDraft((draft) => ({ ...draft, scheduledAt: event.target.value }))}
                  aria-label="Announcement delivery time"
                  className="min-w-0 rounded border border-white/10 bg-slate-900 px-2 py-2 text-xs text-white"
                  disabled={!canPostToCommunityChannel || announcementSaving}
                />
                <select
                  value={announcementDraft.recurrence}
                  onChange={(event) => setAnnouncementDraft((draft) => ({ ...draft, recurrence: event.target.value }))}
                  aria-label="Announcement recurrence"
                  className="rounded border border-white/10 bg-slate-900 px-2 py-2 text-xs text-white"
                  disabled={!canPostToCommunityChannel || announcementSaving}
                >
                  <option value="once">Once</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
                <button
                  type="submit"
                  disabled={!canPostToCommunityChannel || announcementSaving || !announcementDraft.content.trim() || !announcementDraft.scheduledAt}
                  aria-label="Schedule announcement"
                  title="Schedule announcement"
                  className="inline-flex items-center justify-center gap-2 rounded bg-accent px-3 py-2 text-xs font-semibold text-accent-contrast disabled:opacity-40"
                >
                  <FaCalendarAlt /> Schedule
                </button>
              </form>
              {announcementError && <p role="alert" className="text-xs text-rose-200">{announcementError}</p>}
              {scheduledAnnouncements.length > 0 && (
                <ul className="max-h-24 space-y-1 overflow-y-auto" aria-label="Upcoming announcements">
                  {scheduledAnnouncements.map((post) => (
                    <li key={post.id} className="flex min-w-0 items-center gap-2 text-xs">
                      <time className="shrink-0 text-white/50" dateTime={post.scheduledAt}>
                        {new Date(post.scheduledAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      </time>
                      <span className="min-w-0 flex-1 truncate text-white/80">{post.content}</span>
                      <span className="shrink-0 text-white/40">{post.recurrence}</span>
                      <button type="button" onClick={() => cancelScheduledAnnouncement(post.id)} className="grid h-7 w-7 shrink-0 place-items-center rounded text-white/50 hover:bg-white/10 hover:text-rose-200" aria-label="Cancel scheduled announcement" title="Cancel scheduled announcement"><FaTimes size={11} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {selectedChat && (
            <section className="mx-auto mb-2 max-w-4xl border-b border-white/10 pb-2" aria-label="Scheduled messages">
              <button
                type="button"
                onClick={() => setScheduledMessagesOpen((open) => !open)}
                aria-expanded={scheduledMessagesOpen}
                className="inline-flex items-center gap-2 rounded px-2 py-1 text-xs text-white/65 hover:bg-white/10 hover:text-white"
              >
                <FaCalendarAlt /> Scheduled messages{scheduledMessages.length ? ` · ${scheduledMessages.length}` : ''}
              </button>
              {scheduledMessagesOpen && (
                <div className="mt-2 space-y-2">
                  <form onSubmit={submitScheduledMessage} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <p className="theme-muted flex min-w-0 items-center px-2 text-xs">
                      {editingScheduledMessageId ? 'Edit the draft in the composer, then choose a new delivery time.' : 'Enter a message in the composer and choose its delivery time.'}
                    </p>
                    <input
                      type="datetime-local"
                      value={scheduledMessageAt}
                      onChange={(event) => setScheduledMessageAt(event.target.value)}
                      aria-label="Scheduled message delivery time"
                      className="min-w-0 rounded border border-white/10 bg-slate-900 px-2 py-2 text-xs text-white"
                    />
                    <div className="flex gap-1">
                      <button
                        type="submit"
                        disabled={!msg.trim() || !scheduledMessageAt || scheduledMessageSaving || !canPostToCommunityChannel || selectedFiles.length > 0 || Boolean(voiceFile) || isCommunityChat && communityComposerType !== 'message'}
                        className="inline-flex items-center justify-center gap-2 rounded bg-accent px-3 py-2 text-xs font-semibold text-accent-contrast disabled:opacity-40"
                      >
                        <FaCalendarAlt /> {scheduledMessageSaving ? 'Saving…' : editingScheduledMessageId ? 'Update' : 'Schedule'}
                      </button>
                      {editingScheduledMessageId && (
                        <button type="button" onClick={() => { setEditingScheduledMessageId(null); setScheduledMessageAt(''); setMsg(''); }} className="rounded border border-white/10 px-2 text-xs text-white/65 hover:bg-white/10">Cancel edit</button>
                      )}
                    </div>
                  </form>
                  {scheduledMessageError && <p role="alert" className="text-xs text-rose-200">{scheduledMessageError}</p>}
                  {scheduledMessages.length > 0 && (
                    <ul className="max-h-28 space-y-1 overflow-y-auto" aria-label="Pending scheduled messages">
                      {scheduledMessages.map((message) => (
                        <li key={message.id} className="flex min-w-0 items-center gap-2 text-xs">
                          <time className="shrink-0 text-white/50" dateTime={message.scheduledAt}>
                            {new Date(message.scheduledAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                          </time>
                          <span className="min-w-0 flex-1 truncate text-white/80">{message.content}</span>
                          <button type="button" onClick={() => editScheduledMessage(message)} aria-label="Edit scheduled message" title="Edit" className="rounded px-2 py-1 text-accent-text hover:bg-white/10">Edit</button>
                          <button type="button" onClick={() => cancelScheduledMessage(message.id)} aria-label="Cancel scheduled message" title="Cancel" className="grid h-7 w-7 shrink-0 place-items-center rounded text-white/50 hover:bg-white/10 hover:text-rose-200"><FaTimes size={11} /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}
          {pendingForward && (
            <p className="mx-auto mb-2 max-w-4xl text-xs text-accent-text">
              Choose a chat from the sidebar to forward this message.
            </p>
          )}
          {isCommunityChat && (
            <div className="mx-auto mb-2 flex max-w-4xl items-center gap-1 overflow-x-auto rounded-lg border border-white/10 bg-black/10 p-1" role="group" aria-label="Community post type">
              {[
                ['message', 'Message'], ['question', 'Question'], ['poll', 'Poll'], ['event', 'Event'],
              ].map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setCommunityComposerType(type)}
                  aria-pressed={communityComposerType === type}
                  className={`shrink-0 rounded px-3 py-1.5 text-xs font-medium ${communityComposerType === type ? 'bg-accent text-accent-contrast' : 'theme-muted hover:bg-white/10'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {isCommunityChat && communityComposerType === 'question' && (
            <div className="mx-auto mb-2 grid max-w-4xl gap-2 rounded-lg border border-accent-border bg-accent-soft p-3 sm:grid-cols-[minmax(10rem,0.35fr)_1fr]">
              <label className="min-w-0 text-[10px] text-white/55">Category
                <select value={questionCategory} onChange={(event) => setQuestionCategory(event.target.value)} className="mt-1 block w-full rounded border border-white/10 bg-slate-900 px-2.5 py-2 text-xs text-white focus:border-accent-border">
                  {COMMUNITY_QUESTION_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <label className="min-w-0 text-[10px] text-white/55">Tags · up to 5
                <input value={questionTags} onChange={(event) => setQuestionTags(event.target.value)} maxLength={150} placeholder="javascript, mysql, deployment" aria-label="Question tags" className="mt-1 block w-full rounded border border-white/10 bg-slate-900 px-2.5 py-2 text-xs text-white placeholder:text-white/40 focus:border-accent-border" />
              </label>
            </div>
          )}
          {isCommunityChat && communityComposerType === 'poll' && (
            <div className="mx-auto mb-2 max-w-4xl space-y-2 rounded-lg border border-accent-border bg-accent-soft p-3">
              <input value={pollDraft.question} onChange={(event) => setPollDraft((draft) => ({ ...draft, question: event.target.value }))} maxLength={300} placeholder="What should the community decide?" aria-label="Poll question" className="w-full rounded border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-accent-border" />
              <div className="grid gap-2 sm:grid-cols-2">
                {pollDraft.options.map((option, index) => (
                  <div key={index} className="flex min-w-0 items-center gap-1.5">
                    <input value={option} onChange={(event) => setPollDraft((draft) => ({ ...draft, options: draft.options.map((current, optionIndex) => optionIndex === index ? event.target.value : current) }))} maxLength={100} placeholder={`Option ${index + 1}`} aria-label={`Poll option ${index + 1}`} className="min-w-0 flex-1 rounded border border-white/10 bg-black/20 px-2.5 py-2 text-xs text-white outline-none focus:border-accent-border" />
                    {pollDraft.options.length > 2 && <button type="button" onClick={() => setPollDraft((draft) => ({ ...draft, options: draft.options.filter((_, optionIndex) => optionIndex !== index) }))} className="grid h-8 w-8 shrink-0 place-items-center text-white/50 hover:text-rose-300" aria-label={`Remove option ${index + 1}`}><FaTimes size={11} /></button>}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => setPollDraft((draft) => ({ ...draft, options: [...draft.options, ''] }))} disabled={pollDraft.options.length >= 8} className="text-xs text-accent-text hover:text-accent-hover disabled:opacity-40">Add option</button>
                <label className="flex items-center gap-2 text-xs text-white/65"><input type="checkbox" checked={pollDraft.multipleChoice} onChange={(event) => setPollDraft((draft) => ({ ...draft, multipleChoice: event.target.checked }))} className="accent-accent" /> Allow multiple selections</label>
              </div>
            </div>
          )}
          {isCommunityChat && communityComposerType === 'event' && (
            <div className="mx-auto mb-2 grid max-w-4xl gap-2 rounded-lg border border-accent-border bg-accent-soft p-3 sm:grid-cols-2">
              <input value={eventDraft.title} onChange={(event) => setEventDraft((draft) => ({ ...draft, title: event.target.value }))} maxLength={120} placeholder="Event title" aria-label="Event title" className="rounded border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-accent-border" />
              <input type="datetime-local" value={eventDraft.startsAt} onChange={(event) => setEventDraft((draft) => ({ ...draft, startsAt: event.target.value }))} aria-label="Event date and time" className="rounded border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none focus:border-accent-border" />
              <input value={eventDraft.location} onChange={(event) => setEventDraft((draft) => ({ ...draft, location: event.target.value }))} maxLength={200} placeholder="Location or meeting link" aria-label="Event location" className="rounded border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none focus:border-accent-border" />
              <input value={eventDraft.description} onChange={(event) => setEventDraft((draft) => ({ ...draft, description: event.target.value }))} maxLength={3000} placeholder="Description (Markdown supported)" aria-label="Event description" className="rounded border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none focus:border-accent-border" />
            </div>
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
                ref={stickerPanel.triggerRef}
                onClick={() => setShowStickers((current) => !current)}
                  disabled={!selectedChat || isSending || isStructuredComposer || !canPostToCommunityChannel}
                className="chat-action theme-text grid h-10 w-10 place-items-center rounded-xl border transition hover:text-accent-text disabled:opacity-50"
                title="Stickers"
                aria-label="Open stickers"
              >
                <FaSmile />
              </button>
              <FloatingPanel open={showStickers} panelRef={stickerPanel.panelRef} style={stickerPanel.style} className="w-[min(22rem,calc(100vw-1rem))] rounded-xl border border-white/15 bg-slate-950 p-3 shadow-xl">
                  <div className="mb-2 flex flex-wrap gap-1 border-b border-white/10 pb-2">
                    {['all', 'favorites', 'recent', ...stickerCategories].map((category) => (
                      <button type="button" key={category} onClick={() => setStickerCategory(category)} className={`rounded px-2 py-1 text-[11px] capitalize ${stickerCategory === category ? 'bg-accent text-accent-contrast' : 'text-white/70 hover:bg-white/10'}`}>
                        {category === 'all' ? 'All' : category}
                      </button>
                    ))}
                  </div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <button type="button" onClick={() => setShowAddSticker((current) => !current)} className="rounded bg-accent px-2 py-1 text-[11px] font-semibold text-accent-contrast">
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
                      <button type="button" onClick={addSticker} className="rounded bg-accent px-2 py-1 text-[11px] font-semibold text-accent-contrast">Add</button>
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
              </FloatingPanel>
            </div>
            <button
              type="button"
              onClick={() => setShowVoiceRecorder(true)}
              disabled={!selectedChat || isSending || isStructuredComposer || !canPostToCommunityChannel}
              className="chat-action theme-text grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition hover:text-accent-text disabled:opacity-50"
              title="Record a voice message"
              aria-label="Record a voice message"
            >
              <FaMicrophone />
            </button>
            {isStructuredComposer ? (
              <span className="theme-muted min-w-0 flex-1 px-3 text-xs">{communityComposerType === 'poll' ? 'Poll details above' : 'Event details above'}</span>
            ) : isCommunityChat ? (
              <textarea
                data-community-composer
                value={msg}
                onChange={(event) => setMsg(event.target.value)}
                rows={2}
                maxLength={10000}
                className="theme-composer-input min-h-11 min-w-0 flex-1 resize-y bg-transparent px-3 py-2 text-sm leading-5 outline-none placeholder:opacity-60"
                placeholder={communityComposerType === 'question' ? 'Describe the issue, expected behavior, and relevant context…' : `Message #${selectedChat.channelName || selectedChat.name}…`}
                disabled={!selectedChat || isSending || !canPostToCommunityChannel}
              />
            ) : (
              <input
                value={msg}
                onChange={(event) => setMsg(event.target.value)}
                className="theme-composer-input min-w-0 flex-1 bg-transparent px-3 py-3 text-base outline-none placeholder:opacity-60 sm:text-sm"
                placeholder={selectedChat ? `Message ${selectedChat.name || selectedChat.username}...` : 'Choose a conversation first'}
                disabled={!selectedChat || isSending || !canPostToCommunityChannel}
              />
            )}
            <button
              type="button"
              title="Attach images, audio, video, or PDF files (up to 50 MB each)"
              aria-label="Attach files"
              onClick={() => fileInputRef.current?.click()}
              disabled={!selectedChat || isSending || isStructuredComposer || !canPostToCommunityChannel}
              className="chat-action theme-text inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm transition hover:text-accent-text disabled:opacity-50"
            >
              <FaPaperclip />
              <span>Attach</span>
            </button>
            <button
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
              type="submit"
              disabled={!selectedChat || (!composerCanSend && !selectedFiles.length && !voiceFile) || isStructuredComposer && (selectedFiles.length > 0 || Boolean(voiceFile)) || !socketConnected || isSending || !canPostToCommunityChannel}
            >
              {isSending ? 'Sending…' : 'Send'}
            </button>
          </form>
          {replyTo && (
            <div className="mx-auto mt-2 flex max-w-4xl items-start gap-2 rounded-lg border border-accent-border px-3 py-2 text-xs sm:items-center" role="status" aria-label="Reply preview">
              <FaReply className="mt-0.5 shrink-0 text-accent-text sm:mt-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">Replying to {replyTo.senderName || (String(replyTo.sender) === String(user?._id) ? 'yourself' : 'message')}</span>
                <span className="block max-h-10 overflow-hidden break-words leading-5 sm:max-h-5 sm:truncate">{replyTo.content || 'Attachment'}</span>
              </span>
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
          {voiceFile && (
            <div className="mx-auto mt-2 flex max-w-4xl items-center gap-2 rounded-lg border border-accent-border px-3 py-2">
              <span className="shrink-0 text-xs font-medium">Voice preview</span>
              {voicePreviewUrl && <audio controls preload="metadata" src={voicePreviewUrl} className="min-w-0 flex-1" />}
              <button
                type="button"
                onClick={() => setVoiceFile(null)}
                disabled={isSending}
                aria-label="Remove voice recording"
                className="shrink-0 text-sm text-rose-300"
              >
                Remove
              </button>
            </div>
          )}
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

        {activeThread && (() => {
          const threadRoot = messages.find((message) => String(message._id) === String(activeThread._id)) || activeThread;
          const replies = messages.filter((message) => String(message.replyToId) === String(threadRoot._id));
          const canAcceptAnswer = threadRoot.messageType === 'question'
            && (String(threadRoot.sender) === String(user?._id) || selectedChat?.role === 'admin' || user?.role === 'admin');
          return (
            <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setActiveThread(null)}>
              <section role="dialog" aria-modal="true" aria-label="Message thread" className="theme-page flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-white/10 shadow-2xl sm:rounded-xl">
                <header className="theme-header flex shrink-0 items-center gap-3 border-b px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold">{threadRoot.messageType === 'question' ? 'Question discussion' : 'Thread'}</h2>
                    <p className="theme-muted mt-0.5 truncate text-xs">#{selectedChat?.channelName || 'community'}</p>
                  </div>
                  <button type="button" onClick={() => setActiveThread(null)} className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 text-white/65 hover:bg-white/10 hover:text-white" aria-label="Close thread"><FaTimes /></button>
                </header>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                  <article className="border-b border-white/10 pb-3">
                    <p className="mb-1 text-xs font-semibold text-sky-200">{threadRoot.senderName || 'Community member'} · original post</p>
                    {threadRoot.messageType && ['poll', 'event'].includes(threadRoot.messageType)
                      ? <CommunityPostCard message={threadRoot} threadCount={replies.length} onVote={voteInPoll} onRsvp={respondToEvent} onOpenThread={setActiveThread} />
                      : <MarkdownMessage>{threadRoot.content}</MarkdownMessage>}
                  </article>
                  {replies.length ? replies.map((reply) => (
                    <article key={reply._id} className={`rounded-lg border p-3 ${String(threadRoot.acceptedAnswerId) === String(reply._id) ? 'border-emerald-300/40 bg-emerald-950/20' : 'border-white/10 bg-white/[0.025]'}`}>
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-white/75">{reply.senderName || 'Community member'}{String(reply.sender) === String(user?._id) ? ' · you' : ''}</p>
                        {String(threadRoot.acceptedAnswerId) === String(reply._id) && <span className="text-[10px] font-semibold text-emerald-200">Accepted answer</span>}
                      </div>
                      {reply.content && <MarkdownMessage>{reply.content}</MarkdownMessage>}
                      {canAcceptAnswer && !reply.isDeleted && (
                        <button type="button" onClick={() => setAcceptedAnswer(threadRoot, String(threadRoot.acceptedAnswerId) === String(reply._id) ? null : reply._id)} className="mt-2 text-[10px] font-medium text-emerald-200 hover:text-white">
                          {String(threadRoot.acceptedAnswerId) === String(reply._id) ? 'Unmark accepted answer' : 'Mark as accepted answer'}
                        </button>
                      )}
                    </article>
                  )) : <p className="theme-muted py-8 text-center text-sm">No replies yet.</p>}
                </div>
                <footer className="theme-footer flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3">
                  <span className="theme-muted text-xs">{replies.length} repl{replies.length === 1 ? 'y' : 'ies'}</span>
                  <button type="button" onClick={() => { setReplyTo(threadRoot); setActiveThread(null); }} disabled={!socketConnected || selectedChat?.channelCanPost === false || selectedChat?.channelCanPost === undefined && selectedChat?.channelPostingMode === 'admins' && selectedChat?.role !== 'admin' && user?.role !== 'admin'} className="rounded bg-accent px-3 py-2 text-xs font-semibold text-accent-contrast disabled:opacity-40">Reply in thread</button>
                </footer>
              </section>
            </div>
          );
        })()}

        {showVoiceRecorder && (
          <VoiceRecorder
            maxDurationSeconds={Number.isSafeInteger(Number(import.meta.env.VITE_MAX_VOICE_MESSAGE_SECONDS))
              && Number(import.meta.env.VITE_MAX_VOICE_MESSAGE_SECONDS) > 0
              ? Math.min(Number(import.meta.env.VITE_MAX_VOICE_MESSAGE_SECONDS), 3600)
              : 300}
            onClose={() => setShowVoiceRecorder(false)}
            onRecorded={(file) => {
              if (selectedFiles.length >= MAX_FILES_PER_MESSAGE) {
                window.alert(`You can send up to ${MAX_FILES_PER_MESSAGE} files per message.`);
                return;
              }
              setVoiceFile(file);
              setShowVoiceRecorder(false);
            }}
          />
        )}

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
