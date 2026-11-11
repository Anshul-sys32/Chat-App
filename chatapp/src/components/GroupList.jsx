import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { createPortal } from 'react-dom';
import { FaArchive, FaCamera, FaChevronDown, FaChevronUp, FaCrown, FaExchangeAlt, FaHashtag, FaLock, FaPlus, FaTimes, FaUserMinus, FaUserPlus, FaUsers } from 'react-icons/fa';
import Socket from '../Socket';
import Avatar from './Avatar';

const apiUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";
const authConfig = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
});
const hasPermission = (group, permission, platformAdmin) => {
  if (platformAdmin || group?.role === 'admin') return true;
  let permissions = group?.rolePermissions;
  if (typeof permissions === 'string') {
    try { permissions = JSON.parse(permissions); } catch { permissions = {}; }
  }
  return permissions?.[permission] === true;
};

export default function GroupList({ search = '', onSelectGroup, isAdmin = false }) {
  const [groups, setGroups] = useState([]);
  const [activeGroup, setActiveGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [groupRoles, setGroupRoles] = useState([]);
  const [name, setName] = useState('');
  const [groupType, setGroupType] = useState('standard');
  const [channels, setChannels] = useState([]);
  const [newChannelName, setNewChannelName] = useState('');
  const [channelPostingMode, setChannelPostingMode] = useState('members');
  const [newRoleName, setNewRoleName] = useState('');
  const [newRolePermissions, setNewRolePermissions] = useState({ manageRoles: false, manageMembers: false, manageChannels: false, manageMessages: false, postMessages: true });
  const [permissionChannelId, setPermissionChannelId] = useState('');
  const [permissionRoleKey, setPermissionRoleKey] = useState('');
  const [channelRolePermissions, setChannelRolePermissions] = useState([]);
  const [memberIdentifier, setMemberIdentifier] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isManagementOpen, setIsManagementOpen] = useState(false);
  const [chatAreaOverlay, setChatAreaOverlay] = useState(null);
  let currentUser = null;
  try {
    currentUser = JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    localStorage.removeItem('user');
  }

  useEffect(() => {
    setChatAreaOverlay(document.getElementById('chat-area-overlay'));
  }, []);

  useEffect(() => {
    let active = true;
    axios.get(`${apiUrl}${isAdmin ? '/api/admin/groups' : '/api/groups'}`, authConfig()).then(({ data }) => {
      if (active) setGroups(data);
    }).catch((requestError) => {
      if (active) setError(requestError.response?.data?.message || 'Could not load groups.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [isAdmin]);

  useEffect(() => {
    const handleRemoved = ({ groupId }) => {
      setGroups((previous) => previous.filter((group) => String(group._id) !== String(groupId)));
      setActiveGroup((previous) => previous && String(previous._id) === String(groupId) ? null : previous);
    };
    const handleDeactivated = ({ groupId }) => {
      if (isAdmin) {
        setGroups((previous) => previous.map((group) => String(group._id) === String(groupId) ? { ...group, isActive: 0 } : group));
      } else {
        setGroups((previous) => previous.filter((group) => String(group._id) !== String(groupId)));
      }
      setActiveGroup((previous) => previous && String(previous._id) === String(groupId) ? null : previous);
      setIsManagementOpen(false);
    };
    const handleReactivated = (group) => {
      if (!isAdmin) {
        setGroups((previous) => previous.some((item) => String(item._id) === String(group._id))
          ? previous.map((item) => String(item._id) === String(group._id) ? { ...item, ...group } : item)
          : [...previous, group]);
      } else {
        setGroups((previous) => previous.map((item) => String(item._id) === String(group._id) ? { ...item, ...group } : item));
      }
    };
    const handleGroupUpdated = (group) => {
      setGroups((previous) => previous.map((item) => String(item._id) === String(group._id) ? { ...item, ...group } : item));
      setActiveGroup((previous) => previous && String(previous._id) === String(group._id) ? { ...previous, ...group } : previous);
    };
    const handleRoleChange = ({ groupId, userId, role, roleName }) => {
      if (String(userId) === String(currentUser?._id)) {
        setGroups((previous) => previous.map((group) => String(group._id) === String(groupId) ? { ...group, role, roleName } : group));
        setActiveGroup((previous) => previous && String(previous._id) === String(groupId) ? { ...previous, role, roleName } : previous);
      }
      setMembers((previous) => previous.map((member) => String(member._id) === String(userId) ? { ...member, role, roleName } : member));
    };
    const handleRolesUpdated = ({ groupId }) => {
      if (String(activeGroup?._id) === String(groupId) && activeGroup) refreshMembers(activeGroup);
    };
    const handleMemberAdded = (event) => {
      const { groupId, member, groupName, members: memberCount } = event;
      setGroups((previous) => previous.map((group) => String(group._id) === String(groupId)
        ? { ...group, members: memberCount }
        : group));
      if (String(activeGroup?._id) === String(groupId)) {
        setMembers((previous) => previous.some((current) => String(current._id) === String(member._id))
          ? previous
          : [...previous, member]);
      } else if (!groups.some((group) => String(group._id) === String(groupId))
        && String(member._id) === String(currentUser?._id)) {
        setGroups((previous) => [...previous, {
          _id: groupId,
          name: groupName,
          avatarUrl: event.avatarUrl,
          groupType: event.groupType || 'standard',
          isActive: 1,
          members: memberCount,
          role: 'member',
        }]);
      }
    };
    const handleMemberChanged = ({ groupId, userId }) => {
      setGroups((previous) => previous.map((group) => String(group._id) === String(groupId)
        ? { ...group, members: Math.max(0, Number(group.members) - 1) }
        : group));
      if (String(activeGroup?._id) === String(groupId)) {
        setMembers((previous) => previous.filter((member) => String(member._id) !== String(userId)));
      }
    };
    const handleGroupPicture = ({ groupId, avatarUrl }) => {
      setGroups((previous) => previous.map((group) => String(group._id) === String(groupId)
        ? { ...group, avatarUrl }
        : group));
      setActiveGroup((previous) => previous && String(previous._id) === String(groupId)
        ? { ...previous, avatarUrl }
        : previous);
    };
    const handleProfilePicture = ({ userId, profilePicture }) => {
      setMembers((previous) => previous.map((member) => String(member._id) === String(userId)
        ? { ...member, profilePicture }
        : member));
    };
    const handleChannelCreated = (channel) => {
      if (String(activeGroup?._id) !== String(channel.groupId)) return;
      setChannels((previous) => previous.some((item) => String(item._id) === String(channel._id))
        ? previous
        : [...previous, channel].sort((a, b) => a.sortOrder - b.sortOrder));
    };
    const handleChannelUpdated = (channel) => {
      setChannels((previous) => previous.map((item) => String(item._id) === String(channel._id) ? channel : item));
    };
    const handleChannelArchived = ({ channelId }) => {
      setChannels((previous) => previous.filter((item) => String(item._id) !== String(channelId)));
    };
    Socket.on('group-member-removed', handleRemoved);
    Socket.on('group-deactivated', handleDeactivated);
    Socket.on('group-reactivated', handleReactivated);
    Socket.on('group-updated', handleGroupUpdated);
    Socket.on('group-role-updated', handleRoleChange);
    Socket.on('group-roles-updated', handleRolesUpdated);
    Socket.on('group-member-added', handleMemberAdded);
    Socket.on('group-member-changed', handleMemberChanged);
    Socket.on('group-picture-updated', handleGroupPicture);
    Socket.on('profile-picture-updated', handleProfilePicture);
    Socket.on('group-channel-created', handleChannelCreated);
    Socket.on('group-channel-updated', handleChannelUpdated);
    Socket.on('group-channel-archived', handleChannelArchived);
    return () => {
      Socket.off('group-member-removed', handleRemoved);
      Socket.off('group-deactivated', handleDeactivated);
      Socket.off('group-reactivated', handleReactivated);
      Socket.off('group-updated', handleGroupUpdated);
      Socket.off('group-role-updated', handleRoleChange);
      Socket.off('group-roles-updated', handleRolesUpdated);
      Socket.off('group-member-added', handleMemberAdded);
      Socket.off('group-member-changed', handleMemberChanged);
      Socket.off('group-picture-updated', handleGroupPicture);
      Socket.off('profile-picture-updated', handleProfilePicture);
      Socket.off('group-channel-created', handleChannelCreated);
      Socket.off('group-channel-updated', handleChannelUpdated);
      Socket.off('group-channel-archived', handleChannelArchived);
    };
  }, [currentUser?._id, activeGroup?._id, groups, isAdmin]);

  const refreshMembers = async (group) => {
    setError('');
    try {
      const [memberResponse, channelResponse, roleResponse] = await Promise.all([
        axios.get(`${apiUrl}/api/groups/${group._id}/members`, authConfig()),
        group.groupType === 'community' && group.isActive !== 0
          ? axios.get(`${apiUrl}/api/groups/${group._id}/channels`, authConfig())
          : Promise.resolve({ data: { channels: [] } }),
        axios.get(`${apiUrl}/api/groups/${group._id}/roles`, authConfig()),
      ]);
      setMembers(memberResponse.data);
      setChannels(channelResponse.data.channels || []);
      setGroupRoles(roleResponse.data.roles || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load group members.');
    }
  };

  const createRole = async (event) => {
    event.preventDefault();
    if (!activeGroup || !newRoleName.trim()) return;
    try {
      await axios.post(`${apiUrl}/api/groups/${activeGroup._id}/roles`, {
        name: newRoleName.trim(),
        permissions: newRolePermissions,
      }, authConfig());
      setNewRoleName('');
      setNewRolePermissions({ manageRoles: false, manageMembers: false, manageChannels: false, manageMessages: false, postMessages: true });
      await refreshMembers(activeGroup);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not create group role.');
    }
  };

  const deleteRole = async (role) => {
    if (!activeGroup || role.isSystem || !window.confirm(`Delete the ${role.name} role?`)) return;
    try {
      await axios.delete(`${apiUrl}/api/groups/${activeGroup._id}/roles/${encodeURIComponent(role.roleKey)}`, authConfig());
      await refreshMembers(activeGroup);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not delete group role.');
    }
  };

  const loadChannelRolePermissions = async (channelId) => {
    if (!activeGroup || !channelId) return;
    setPermissionChannelId(String(channelId));
    try {
      const { data } = await axios.get(`${apiUrl}/api/groups/${activeGroup._id}/channels/${channelId}/role-permissions`, authConfig());
      setChannelRolePermissions(data.roles || []);
      setPermissionRoleKey((current) => current && data.roles.some((role) => role.roleKey === current)
        ? current
        : data.roles.find((role) => role.roleKey !== 'admin')?.roleKey || '');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load channel permissions.');
    }
  };

  const updateChannelRolePermission = async () => {
    const role = channelRolePermissions.find((item) => item.roleKey === permissionRoleKey);
    if (!activeGroup || !permissionChannelId || !role) return;
    const canPost = role.canPost === null || role.canPost === undefined
      ? role.roleKey === 'admin' || channels.find((channel) => String(channel._id) === permissionChannelId)?.postingMode === 'members' && role.permissions?.postMessages !== false
      : Boolean(role.canPost);
    try {
      await axios.put(`${apiUrl}/api/groups/${activeGroup._id}/channels/${permissionChannelId}/role-permissions`, {
        roleKey: permissionRoleKey,
        canPost: !canPost,
      }, authConfig());
      await loadChannelRolePermissions(permissionChannelId);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not update channel permissions.');
    }
  };

  const showManagement = async (group) => {
    setActiveGroup(group);
    setIsManagementOpen(true);
    await refreshMembers(group);
  };

  const deactivateGroup = async () => {
    if (!activeGroup || !window.confirm(`Deactivate ${activeGroup.name}? It will disappear from every member's sidebar until an administrator restores it.`)) return;
    try {
      await axios.delete(`${apiUrl}/api/groups/${activeGroup._id}`, authConfig());
      setIsManagementOpen(false);
      if (!isAdmin) setGroups((previous) => previous.filter((group) => String(group._id) !== String(activeGroup._id)));
      else setGroups((previous) => previous.map((group) => String(group._id) === String(activeGroup._id) ? { ...group, isActive: 0 } : group));
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not deactivate the group.');
    }
  };

  const updateGroupName = async (event) => {
    event.preventDefault();
    if (!activeGroup || !activeGroup.name.trim()) return;
    try {
      const { data } = await axios.patch(`${apiUrl}/api/groups/${activeGroup._id}`, { name: activeGroup.name }, authConfig());
      setGroups((previous) => previous.map((group) => String(group._id) === String(data._id) ? { ...group, ...data } : group));
      setActiveGroup((previous) => ({ ...previous, ...data }));
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not rename the group.');
    }
  };

  const reactivateGroup = async () => {
    if (!activeGroup || !isAdmin) return;
    try {
      const { data } = await axios.patch(`${apiUrl}/api/groups/${activeGroup._id}`, { isActive: true }, authConfig());
      setGroups((previous) => previous.map((group) => String(group._id) === String(data._id) ? { ...group, ...data } : group));
      setActiveGroup((previous) => ({ ...previous, ...data }));
      await refreshMembers(data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not reactivate the group.');
    }
  };

  const toggleChannels = async (group) => {
    if (String(activeGroup?._id) === String(group._id)) {
      setActiveGroup(null);
      setChannels([]);
      return;
    }
    setActiveGroup(group);
    setIsManagementOpen(false);
    await refreshMembers(group);
  };

  const createGroup = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    setError('');
    try {
      const { data } = await axios.post(`${apiUrl}/api/groups`, { name, groupType }, authConfig());
      setGroups((previous) => [...previous, data]);
      setName('');
      setGroupType('standard');
      setIsCreateOpen(false);
      await showManagement(data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not create group.');
    }
  };

  const createChannel = async (event) => {
    event.preventDefault();
    if (!activeGroup || !newChannelName.trim()) return;
    setError('');
    try {
      const { data } = await axios.post(
        `${apiUrl}/api/groups/${activeGroup._id}/channels`,
        { name: newChannelName, postingMode: channelPostingMode },
        authConfig()
      );
      setChannels((previous) => [...previous, data].sort((a, b) => a.sortOrder - b.sortOrder));
      setNewChannelName('');
      setChannelPostingMode('members');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not create channel.');
    }
  };

  const updateChannelPostingMode = async (channel, postingMode) => {
    try {
      const { data } = await axios.patch(
        `${apiUrl}/api/groups/${activeGroup._id}/channels/${channel._id}`,
        { postingMode },
        authConfig()
      );
      setChannels((previous) => previous.map((item) => String(item._id) === String(data._id) ? data : item));
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not update channel permissions.');
    }
  };

  const archiveChannel = async (channel) => {
    if (!activeGroup || !window.confirm(`Archive #${channel.slug}? Its messages will be retained.`)) return;
    try {
      await axios.delete(`${apiUrl}/api/groups/${activeGroup._id}/channels/${channel._id}`, authConfig());
      setChannels((previous) => previous.filter((item) => String(item._id) !== String(channel._id)));
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not archive channel.');
    }
  };

  const addMember = async (event) => {
    event.preventDefault();
    if (!activeGroup || !memberIdentifier.trim()) return;
    try {
      await axios.post(`${apiUrl}/api/groups/${activeGroup._id}/invitations`, { identifier: memberIdentifier.trim() }, authConfig());
      setMemberIdentifier('');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not send the invitation.');
    }
  };

  const updateRole = async (member, role) => {
    try {
      await axios.patch(`${apiUrl}/api/groups/${activeGroup._id}/members/${member._id}`, { role }, authConfig());
      await refreshMembers(activeGroup);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not update role.');
    }
  };

  const removeMember = async (member) => {
    try {
      await axios.delete(`${apiUrl}/api/groups/${activeGroup._id}/members/${member._id}`, authConfig());
      await refreshMembers(activeGroup);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not remove member.');
    }
  };

  const uploadGroupAvatar = async (group, file) => {
    if (!file) return;
    setError('');
    if (file.size > 5 * 1024 * 1024) {
      setError('Group images must be 5 MB or smaller.');
      return;
    }
    const formData = new FormData();
    formData.append('avatar', file);
    try {
      const { data } = await axios.post(
        `${apiUrl}/api/groups/${group._id}/avatar`,
        formData,
        authConfig()
      );
      setGroups((previous) => previous.map((candidate) => String(candidate._id) === String(group._id)
        ? { ...candidate, avatarUrl: data.avatarUrl }
        : candidate));
      setActiveGroup((previous) => previous && String(previous._id) === String(group._id)
        ? { ...previous, avatarUrl: data.avatarUrl }
        : previous);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not update the group image.');
    }
  };

  const updateGroupType = async (nextType) => {
    if (!activeGroup || nextType === activeGroup.groupType) return;
    setError('');
    try {
      const { data } = await axios.patch(`${apiUrl}/api/groups/${activeGroup._id}`, { groupType: nextType }, authConfig());
      setGroups((previous) => previous.map((group) => String(group._id) === String(data._id) ? { ...group, ...data } : group));
      setActiveGroup((previous) => ({ ...previous, ...data }));
      setChannels([]);
      if (nextType === 'community') await refreshMembers({ ...activeGroup, ...data });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not change the group type.');
    }
  };

  const visibleGroups = groups.filter((group) => group.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="text-white">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-300">Your groups</h3>
        <button type="button" onClick={() => setIsCreateOpen(true)} className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 text-gray-300 transition hover:border-accent-border hover:bg-white/10 hover:text-accent-text" title="Create a new group" aria-label="Create a new group">
          <FaPlus size={11} />
        </button>
      </div>
      <ul className="space-y-1.5">
        {!loading && visibleGroups.length === 0 && <li className="rounded-md border border-dashed border-gray-700 px-3 py-4 text-center text-xs text-gray-400">No groups found</li>}
        {visibleGroups.map((group) => (
          <li key={group._id} className={`relative rounded-xl border transition ${activeGroup?._id === group._id ? 'border-accent-border bg-accent-soft' : 'border-white/[0.07] bg-white/[0.045] hover:border-accent-border hover:bg-accent-soft'}`}>
            <div className="flex items-center gap-2 px-2.5 py-2">
              <button type="button" onClick={() => showManagement(group)} className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-accent-border" aria-label={`Manage ${group.name}`}>
                <Avatar src={group.avatarUrl} name={group.name} group className="h-9 w-9 text-sm" />
              </button>
              <button
                type="button"
                onClick={() => group.groupType === 'community'
                  ? toggleChannels(group)
                  : onSelectGroup?.({ ...group, type: 'group' })}
                className="group relative min-w-0 flex-1 text-left"
                aria-label={group.groupType === 'community'
                  ? `${activeGroup?._id === group._id ? 'Hide' : 'Show'} channels in ${group.name}`
                  : `Open ${group.name}`}
                aria-expanded={group.groupType === 'community' ? String(activeGroup?._id === group._id) : undefined}
              >
                <span className="block truncate text-sm font-semibold">{group.name}</span>
                <span className="mt-0.5 flex items-center gap-1 text-[11px] text-white/55">
                  <FaUsers size={10} /> {group.members} · {group.role} {group.isActive === 0 && <span className="text-rose-300">· inactive</span>}
                </span>
              </button>
              {group.groupType === 'community' && <button type="button" onClick={() => toggleChannels(group)} className="grid h-7 w-7 shrink-0 place-items-center rounded text-gray-300 transition hover:bg-white/10 hover:text-white" aria-label={`${activeGroup?._id === group._id ? 'Hide' : 'Show'} channels of ${group.name}`}>{activeGroup?._id === group._id ? <FaChevronUp size={11} /> : <FaChevronDown size={11} />}</button>}
            </div>
            {group.groupType === 'community' && activeGroup?._id === group._id && !isManagementOpen && (
              <div className="border-t border-white/10 px-2.5 py-2.5">
                <div className="mb-2 flex items-center justify-between"><span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-gray-300"><FaHashtag size={10} /> Channels</span><span className="text-[10px] text-gray-400">{channels.length}</span></div>
                {channels.length > 0
                  ? <ul className="space-y-1">{channels.map((channel) => <li key={channel._id}><button type="button" title={channel.postingMode === 'admins' && !channel.canPost ? `${channel.name}: leaders can post` : channel.name} onClick={() => onSelectGroup?.({ ...group, type: 'group', channelId: channel._id, channelName: channel.name, channelPostingMode: channel.postingMode, channelCanPost: channel.canPost })} className="flex w-full items-center gap-2 rounded-lg bg-gray-900/60 px-2 py-2 text-left text-xs hover:bg-accent-soft hover:text-accent-text"><FaHashtag className="text-[10px] text-white/40" /><span className="truncate">{channel.name}</span>{channel.postingMode === 'admins' && !channel.canPost && <FaLock className="ml-auto shrink-0 text-[9px] text-amber-200/70" aria-label="Leaders only" />}</button></li>)}</ul>
                  : <p className="text-xs text-white/45">No channels yet.</p>}
              </div>
            )}
            {/* Group actions live in the avatar menu so the list stays scannable. */}
            {activeGroup?._id === '__legacy_inline_controls_disabled__' && (
              <div className="border-t border-gray-600 px-2.5 py-2.5">
                {group.groupType === 'community' && (
                  <section className="mb-3 border-b border-white/10 pb-3" aria-label={`${group.name} channels`}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase text-gray-300">Channels</span>
                      <span className="text-[10px] text-gray-400">{channels.length}</span>
                    </div>
                    {group.role === 'admin' && (
                      <form onSubmit={createChannel} className="mb-2 space-y-1.5">
                        <input
                          value={newChannelName}
                          onChange={(event) => setNewChannelName(event.target.value)}
                          maxLength={60}
                          placeholder="Channel name"
                          aria-label="New channel name"
                          className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-xs text-white"
                        />
                        <div className="flex gap-1">
                          <select
                            value={channelPostingMode}
                            onChange={(event) => setChannelPostingMode(event.target.value)}
                            aria-label="Channel posting permissions"
                            className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-900 px-1.5 py-1.5 text-[11px] text-white"
                          >
                            <option value="members">All members can post</option>
                            <option value="admins">Leaders only</option>
                          </select>
                          <button type="submit" disabled={!newChannelName.trim()} className="grid w-7 place-items-center rounded bg-cyan-600 text-white disabled:opacity-40" aria-label="Create channel" title="Create channel">
                            <FaPlus size={10} />
                          </button>
                        </div>
                      </form>
                    )}
                    <ul className="space-y-1">
                      {channels.map((channel) => (
                        <li key={channel._id} className="flex items-center gap-1 rounded bg-gray-900/60 px-2 py-1">
                          <button
                            type="button"
                            onClick={() => onSelectGroup?.({
                              ...group,
                              type: 'group',
                              channelId: channel._id,
                              channelName: channel.name,
                              channelPostingMode: channel.postingMode,
                            })}
                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs hover:text-accent-text"
                            title={`Open ${channel.name}`}
                          >
                            <FaHashtag className="shrink-0 text-[10px]" />
                            <span className="truncate">{channel.name}</span>
                          </button>
                          {group.role === 'admin' && (
                            <>
                              <select
                                value={channel.postingMode}
                                onChange={(event) => updateChannelPostingMode(channel, event.target.value)}
                                aria-label={`${channel.name} posting permissions`}
                                className="max-w-[74px] rounded bg-gray-700 px-1 py-0.5 text-[9px] text-white"
                              >
                                <option value="members">Members</option>
                                <option value="admins">Leaders</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => archiveChannel(channel)}
                                disabled={channel.slug === 'general' || channels.length < 2}
                                aria-label={`Archive ${channel.name}`}
                                title="Archive channel"
                                className="grid h-6 w-6 place-items-center rounded text-gray-400 hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-30"
                              >
                                <FaArchive size={10} />
                              </button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase text-gray-300">Members</span>
                  <span className="text-[10px] text-gray-400">{group.role === 'admin' ? 'Admin controls' : 'View only'}</span>
                </div>
                {group.role === 'admin' && (
                  <label className="mb-2 inline-flex cursor-pointer items-center gap-1.5 rounded border border-white/10 px-2 py-1.5 text-[11px] text-gray-200 transition hover:bg-white/10">
                    <FaCamera size={10} /> Change group photo
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
                      className="sr-only"
                      aria-label={`Change ${group.name} photo`}
                      onChange={(event) => {
                        uploadGroupAvatar(group, event.target.files?.[0]);
                        event.target.value = '';
                      }}
                    />
                  </label>
                )}
                {group.role === 'admin' && (
                  <form onSubmit={addMember} className="mb-2 flex gap-1">
                    <input value={memberIdentifier} onChange={(event) => setMemberIdentifier(event.target.value)} placeholder="Username or email" className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-900 px-1.5 py-1.5 text-xs text-white" aria-label="Username or email to invite" />
                    <button type="submit" disabled={!memberIdentifier.trim()} className="grid w-7 place-items-center rounded bg-cyan-600 text-white disabled:opacity-40" title="Send invitation" aria-label="Send invitation">
                      <FaPlus size={10} />
                    </button>
                  </form>
                )}
                {error && <p role="alert" className="mb-2 text-[11px] text-rose-300">{error}</p>}
                <ul className="space-y-1">
                  {members.map((member) => (
                    <li key={member._id} className="flex min-w-0 items-center gap-1.5 rounded bg-gray-900/60 px-2 py-1.5">
                      <Avatar src={member.profilePicture || member.googlePicture} name={member.username} className="h-6 w-6 text-[10px]" />
                      <span className="min-w-0 flex-1 truncate text-xs" title={member.email}>{member.username}</span>
                      {member.role === 'admin' && <FaCrown className="shrink-0 text-amber-300" size={10} title="Admin" />}
                      {group.role === 'admin' ? (
                        <>
                          <select
                            value={member.role}
                            onChange={(event) => updateRole(member, event.target.value)}
                            className="max-w-[72px] rounded bg-gray-700 px-1 py-0.5 text-[10px] text-white"
                            aria-label={`Role for ${member.username}`}
                          >
                            <option value="admin">Admin</option>
                            <option value="member">Member</option>
                          </select>
                          <button type="button" onClick={() => removeMember(member)} className="grid h-6 w-6 shrink-0 place-items-center rounded text-gray-400 hover:bg-rose-500/20 hover:text-rose-300" title={`Remove ${member.username}`} aria-label={`Remove ${member.username}`}>
                            <FaUserMinus size={11} />
                          </button>
                        </>
                      ) : <span className="text-[10px] text-gray-400">{member.role}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
      {isCreateOpen && createPortal(
        <div className="pointer-events-auto absolute inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && setIsCreateOpen(false)}>
          <form onSubmit={createGroup} className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-950 p-5 text-white shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div><h2 className="text-lg font-semibold">Create a group</h2><p className="mt-1 text-xs text-white/55">Start a private group or a channel-based community.</p></div>
              <button type="button" onClick={() => setIsCreateOpen(false)} className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close create group dialog"><FaTimes /></button>
            </div>
            <label className="block text-sm text-white/75">Group name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoFocus placeholder="e.g. Weekend plans" className="mt-1.5 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-accent" /></label>
            <label className="mt-4 block text-sm text-white/75">Group type<select value={groupType} onChange={(event) => setGroupType(event.target.value)} className="mt-1.5 w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2.5 text-sm text-white"><option value="standard">Standard group</option><option value="community">Community with channels</option></select></label>
            {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setIsCreateOpen(false)} className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/75 hover:bg-white/10">Cancel</button><button type="submit" disabled={!name.trim()} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast disabled:opacity-40">Create group</button></div>
          </form>
        </div>,
        chatAreaOverlay || document.body,
      )}
      {isManagementOpen && activeGroup && createPortal(
        <div className="pointer-events-auto absolute inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && setIsManagementOpen(false)}>
          <section className="max-h-[min(760px,calc(100dvh-2rem))] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-slate-950 p-5 text-white shadow-2xl">
            <div className="mb-5 flex items-start gap-3"><Avatar src={activeGroup.avatarUrl} name={activeGroup.name} group className="h-12 w-12 text-base" /><div className="min-w-0 flex-1"><h2 className="truncate text-lg font-semibold">{activeGroup.name}</h2><p className="text-xs text-white/55">Group management · {activeGroup.members} members {activeGroup.isActive === 0 && <span className="text-rose-300">· inactive</span>}</p></div><button type="button" onClick={() => setIsManagementOpen(false)} className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close group management"><FaTimes /></button></div>
            {activeGroup.role === 'admin' && <form onSubmit={updateGroupName} className="mb-4 flex gap-2"><input value={activeGroup.name} onChange={(event) => setActiveGroup((current) => ({ ...current, name: event.target.value }))} maxLength={100} aria-label="Group name" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm" /><button type="submit" className="rounded-lg border border-white/15 px-3 py-2 text-xs hover:bg-white/10">Save name</button></form>}
            {activeGroup.role === 'admin' && <div className="grid gap-2 sm:grid-cols-2"><label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 p-3 text-sm hover:bg-white/10"><FaCamera className="text-accent-text" /> Change group photo<input type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif" className="sr-only" onChange={(event) => { uploadGroupAvatar(activeGroup, event.target.files?.[0]); event.target.value = ''; }} /></label><label className="flex items-center gap-2 rounded-xl border border-white/10 p-3 text-sm"><FaExchangeAlt className="text-accent-text" /> Type<select value={activeGroup.groupType} onChange={(event) => updateGroupType(event.target.value)} className="ml-auto max-w-[130px] rounded bg-slate-900 px-2 py-1 text-xs"><option value="standard">Standard</option><option value="community">Community</option></select></label></div>}
            {activeGroup.role === 'admin' && <form onSubmit={addMember} className="mt-5 rounded-xl border border-white/10 p-3"><div className="mb-2 flex items-center gap-2 text-sm font-semibold"><FaUserPlus className="text-accent-text" /> Invite a member</div><div className="flex gap-2"><input value={memberIdentifier} onChange={(event) => setMemberIdentifier(event.target.value)} placeholder="Username or email" aria-label="Username or email to invite" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-sm" /><button type="submit" disabled={!memberIdentifier.trim()} className="rounded-lg bg-accent px-3 text-accent-contrast disabled:opacity-40" aria-label="Send invitation"><FaPlus /></button></div><p className="mt-2 text-[11px] text-white/45">They must accept the invitation from Alerts.</p></form>}
            {activeGroup.groupType === 'community' && <section className="mt-5 rounded-xl border border-white/10 p-3"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-semibold"><FaHashtag className="text-accent-text" /> Channels</div><span className="text-xs text-white/45">{channels.length}</span></div>{activeGroup.role === 'admin' && <form onSubmit={createChannel} className="mb-3 flex gap-2"><input value={newChannelName} onChange={(event) => setNewChannelName(event.target.value)} maxLength={60} placeholder="New channel" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-sm" /><select value={channelPostingMode} onChange={(event) => setChannelPostingMode(event.target.value)} className="max-w-[120px] rounded-lg border border-white/10 bg-slate-900 px-1 text-xs"><option value="members">Members post</option><option value="admins">Leaders only</option></select><button type="submit" disabled={!newChannelName.trim()} className="rounded-lg bg-accent px-3 text-accent-contrast disabled:opacity-40" aria-label="Create channel"><FaPlus /></button></form>}<ul className="space-y-1">{channels.map((channel) => <li key={channel._id} className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-2"><button type="button" onClick={() => { setIsManagementOpen(false); onSelectGroup?.({ ...activeGroup, type: 'group', channelId: channel._id, channelName: channel.name }); }} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm hover:text-accent-text"><FaHashtag className="text-xs text-white/40" /><span className="truncate">{channel.name}</span></button>{activeGroup.role === 'admin' && <><select value={channel.postingMode} onChange={(event) => updateChannelPostingMode(channel, event.target.value)} className="max-w-[100px] rounded bg-slate-900 px-1 py-1 text-[10px]" aria-label={`${channel.name} posting permissions`}><option value="members">Members</option><option value="admins">Leaders</option></select><button type="button" onClick={() => archiveChannel(channel)} disabled={channel.slug === 'general' || channels.length < 2} className="text-white/45 hover:text-rose-300 disabled:opacity-25" title="Archive channel" aria-label={`Archive ${channel.name}`}><FaArchive size={11} /></button></>}</li>)}</ul></section>}
            <section className="mt-5 rounded-xl border border-white/10 p-3"><div className="mb-3 flex items-center justify-between"><span className="text-sm font-semibold">Members</span><span className="text-xs text-white/45">{members.length}</span></div><ul className="space-y-1">{members.map((member) => <li key={member._id} className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-2"><Avatar src={member.profilePicture || member.googlePicture} name={member.username} className="h-7 w-7 text-[10px]" /><span className="min-w-0 flex-1 truncate text-sm">{member.username}</span>{member.role === 'admin' && <FaCrown className="text-amber-300" size={11} />}{activeGroup.role === 'admin' ? <><select value={member.role} onChange={(event) => updateRole(member, event.target.value)} className="rounded bg-slate-900 px-1 py-1 text-[10px]" aria-label={`Role for ${member.username}`}><option value="admin">Admin</option><option value="member">Member</option></select><button type="button" onClick={() => removeMember(member)} className="text-white/45 hover:text-rose-300" title={`Remove ${member.username}`} aria-label={`Remove ${member.username}`}><FaUserMinus size={11} /></button></> : <span className="text-[10px] text-white/45">{member.role}</span>}</li>)}</ul></section>
            {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">{isAdmin && activeGroup.isActive === 0 ? <button type="button" onClick={reactivateGroup} className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-accent-contrast">Reactivate group</button> : <button type="button" onClick={deactivateGroup} className="rounded-lg border border-rose-300/20 px-3 py-2 text-xs text-rose-200 hover:bg-rose-500/10">Deactivate group</button>}</div>
          </section>
        </div>,
        chatAreaOverlay || document.body,
      )}
    </div>
  );
}
