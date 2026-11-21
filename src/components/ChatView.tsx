import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Image as ImageIcon,
  ArrowLeft,
  Search,
  Sparkles,
  MessageSquarePlus,
  X,
  ZoomIn,
  Reply,
  SmilePlus,
  Trash2,
  Plus,
} from 'lucide-react';
import { Conversation, Message, MessageReaction, Note, User } from '../types';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import { soundFX } from '../lib/sounds';
import { ZoomableImageLightbox } from './ZoomableImageLightbox';
import { cleanChatMessageText, formatChatPreview } from '../lib/postMeta';
import { WarningPopup } from './Modals';

const DM_QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '👍'];

interface ChatViewProps {
  onOpenProfile: (username: string) => void;
  initialRecipientId?: string | null;
  initialConversationId?: string | null;
  onOpenPostId?: (postId: string) => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  onOpenProfile,
  initialRecipientId,
  initialConversationId,
  onOpenPostId,
}) => {
  const { user: currentUser, showToast } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>(
    () => api.getCachedConversations() || []
  );
  const [activeConvId, setActiveConvId] = useState<string | null>(() => initialConversationId || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [otherUser, setOtherUser] = useState<User | null>(null);
  const [otherTyping, setOtherTyping] = useState(false);
  const [otherLastReadAt, setOtherLastReadAt] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<{ id: string; text: string; sender: string } | null>(null);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [myNoteModalOpen, setMyNoteModalOpen] = useState(false);
  const [myNoteText, setMyNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [noteReplyText, setNoteReplyText] = useState('');
  const [sendingNoteReply, setSendingNoteReply] = useState(false);
  const [inputText, setInputText] = useState('');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState<boolean>(() => {
    const cached = api.getCachedConversations();
    return !cached || cached.length === 0;
  });
  const [newChatModalOpen, setNewChatModalOpen] = useState(false);
  const [suggestedUsers, setSuggestedUsers] = useState<User[]>(
    () => api.getCachedSuggestedUsers() || []
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [onlineUsersMap, setOnlineUsersMap] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const seenMsgIdsRef = useRef<Set<string>>(new Set());
  const initialMsgsLoadedRef = useRef(false);
  const typingTimerRef = useRef<number | null>(null);
  const [failedSharedImgs, setFailedSharedImgs] = useState<Record<string, boolean>>({});
  const [msgToUnsend, setMsgToUnsend] = useState<Message | null>(null);

  const trackedPresenceIdsKey = Array.from(
    new Set([
      ...conversations.map((c) => c.other_id).filter(Boolean),
      ...(otherUser?.id ? [otherUser.id] : []),
    ])
  )
    .sort()
    .join(',');

  useEffect(() => {
    const ids = trackedPresenceIdsKey ? trackedPresenceIdsKey.split(',') : [];
    return api.subscribeUsersPresence(ids, setOnlineUsersMap);
  }, [trackedPresenceIdsKey]);

  const loadConversations = async () => {
    try {
      const res = await api.getConversations();
      setConversations(res.conversations);
      if (
        res.conversations.length > 0 &&
        !activeConvId &&
        !initialRecipientId &&
        !initialConversationId &&
        window.innerWidth >= 768
      ) {
        setActiveConvId(res.conversations[0].id);
      }
    } catch {}
    setLoading(false);
  };

  const loadNotes = async () => {
    if (!currentUser?.id) return;
    try {
      const res = await api.getNotes();
      setNotes(res.notes);
    } catch {}
  };

  useEffect(() => {
    loadConversations();
    loadNotes();
  }, [currentUser?.id]);

  // Handle initialConversationId / initialRecipientId if provided (e.g. from alert or profile "Message" button)
  useEffect(() => {
    if (initialConversationId) {
      setActiveConvId(initialConversationId);
      loadConversations();
      return;
    }
    if (initialRecipientId) {
      api.createConversation(initialRecipientId).then((res) => {
        setActiveConvId(res.conversationId);
        loadConversations();
      }).catch(() => {});
    }
  }, [initialConversationId, initialRecipientId]);

  // Real-time Firestore listener for active conversation messages + reactions
  useEffect(() => {
    if (!activeConvId) return;

    let isMounted = true;
    initialMsgsLoadedRef.current = false;
    seenMsgIdsRef.current = new Set();
    setReplyingTo(null);
    setReactionPickerMsgId(null);
    setOtherTyping(false);
    setOtherLastReadAt(null);
    setOtherUser(null);

    api.getConversationOtherUser(activeConvId)
      .then((u) => {
        if (isMounted) setOtherUser(u);
      })
      .catch(() => {});

    api.markConversationRead(activeConvId);

    const unsubMsgs = api.subscribeConversationMessages(
      activeConvId,
      (liveMessages) => {
        if (!isMounted) return;
        if (!initialMsgsLoadedRef.current) {
          liveMessages.forEach((m) => seenMsgIdsRef.current.add(m.id));
          initialMsgsLoadedRef.current = true;
        } else {
          const incomingNew = liveMessages.filter(
            (m) => !seenMsgIdsRef.current.has(m.id) && m.sender_id !== currentUser?.id
          );
          liveMessages.forEach((m) => seenMsgIdsRef.current.add(m.id));
          if (incomingNew.length > 0) {
            soundFX.playMessageReceived();
          }
        }
        setMessages(liveMessages);
        api.markConversationRead(activeConvId);
      }
    );

    const unsubReactions = api.subscribeConversationReactions(activeConvId, (liveReactions) => {
      if (isMounted) setReactions(liveReactions);
    });

    return () => {
      isMounted = false;
      unsubMsgs();
      unsubReactions();
    };
  }, [activeConvId, currentUser?.id]);

  // Live typing indicator & read receipt listeners for the active conversation peer
  useEffect(() => {
    if (!activeConvId || !otherUser?.id) return;
    const unsubTyping = api.subscribeConversationTyping(activeConvId, otherUser.id, setOtherTyping);
    const unsubRead = api.subscribeConversationRead(activeConvId, otherUser.id, setOtherLastReadAt);
    return () => {
      unsubTyping();
      unsubRead();
    };
  }, [activeConvId, otherUser?.id]);

  // Scroll to bottom on new message or typing
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages, otherTyping]);

  // Dismiss reaction picker and chat modals on Escape
  useEffect(() => {
    if (!reactionPickerMsgId && !newChatModalOpen && !myNoteModalOpen && !selectedNote) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (reactionPickerMsgId) setReactionPickerMsgId(null);
      else if (selectedNote && !sendingNoteReply) setSelectedNote(null);
      else if (myNoteModalOpen && !savingNote) setMyNoteModalOpen(false);
      else if (newChatModalOpen) setNewChatModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [reactionPickerMsgId, newChatModalOpen, myNoteModalOpen, savingNote, selectedNote, sendingNoteReply]);

  // Close reaction picker on outside click
  useEffect(() => {
    if (!reactionPickerMsgId) return;
    const closePicker = () => setReactionPickerMsgId(null);
    window.addEventListener('click', closePicker);
    return () => window.removeEventListener('click', closePicker);
  }, [reactionPickerMsgId]);

  const handleTypingActivity = (val: string) => {
    setInputText(val);
    if (!activeConvId) return;
    if (typingTimerRef.current !== null) {
      window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    if (val.trim().length > 0) {
      api.setConversationTyping(activeConvId, true).catch(() => {});
      typingTimerRef.current = window.setTimeout(() => {
        api.setConversationTyping(activeConvId, false).catch(() => {});
      }, 3000);
    } else {
      api.setConversationTyping(activeConvId, false).catch(() => {});
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConvId || (!inputText.trim() && !attachedImage)) return;

    const textToSend = inputText.trim();
    const imgToSend = attachedImage;
    const replyPayload = replyingTo;
    const nowIso = new Date().toISOString();
    const tempId = `temp_msg_${Date.now()}`;

    if (typingTimerRef.current !== null) {
      window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    api.setConversationTyping(activeConvId, false).catch(() => {});

    setInputText('');
    setAttachedImage(null);
    setReplyingTo(null);
    setSending(true);
    soundFX.playMessageSent();

    if (currentUser?.id) {
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: activeConvId,
        sender_id: currentUser.id,
        content: textToSend,
        image_url: imgToSend,
        reply_to_id: replyPayload?.id || null,
        reply_to_text: replyPayload?.text || null,
        reply_to_sender: replyPayload?.sender || null,
        created_at: nowIso,
      };
      setMessages((prev) => [...prev, optimisticMsg]);
      setConversations((prev) => {
        const updated = prev.map((c) =>
          c.id === activeConvId
            ? {
                ...c,
                last_message_content: textToSend || 'Sent an image',
                last_message_time: nowIso,
                last_message_sender: currentUser.id,
                updated_at: nowIso,
              }
            : c
        );
        return updated.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      });
    }

    try {
      await api.sendMessage(activeConvId, textToSend, imgToSend, otherUser?.id, {
        replyTo: replyPayload,
      });
    } catch (err: any) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInputText(textToSend);
      setAttachedImage(imgToSend);
      setReplyingTo(replyPayload);
      showToast(err.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleUnsendMessage = async (msg: Message) => {
    if (!activeConvId) return;
    const prevMsgs = messages;
    const remaining = prevMsgs.filter((m) => m.id !== msg.id);
    const lastRemaining = remaining[remaining.length - 1];
    const fallbackPreview = lastRemaining
      ? cleanChatMessageText(lastRemaining.content) || (lastRemaining.image_url ? 'Sent an image' : 'Message unsent')
      : 'Message unsent';
    setMessages(remaining);
    try {
      await api.unsendMessage(activeConvId, msg.id, fallbackPreview);
      showToast('Message unsent');
    } catch {
      setMessages(prevMsgs);
      showToast('Could not unsend message');
    }
  };

  const handleReactMessage = async (msgId: string, emoji: string) => {
    if (!activeConvId) return;
    setReactionPickerMsgId(null);
    soundFX.playTap();
    try {
      const knownMembers = currentUser?.id && otherUser?.id ? [currentUser.id, otherUser.id].sort() : undefined;
      await api.reactToMessage(activeConvId, msgId, emoji, knownMembers);
    } catch {
      showToast('Could not update reaction');
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploadingImage(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const res = await api.uploadImage(base64);
        setAttachedImage(res.url);
      } catch (err) {
        showToast('Image upload failed');
      } finally {
        setUploadingImage(false);
      }
    };
    reader.onerror = () => setUploadingImage(false);
    reader.readAsDataURL(file);
  };

  const handleStartNewChat = async (participantId: string) => {
    try {
      const res = await api.createConversation(participantId);
      setActiveConvId(res.conversationId);
      setNewChatModalOpen(false);
      loadConversations();
    } catch (err: any) {
      showToast(err.message || 'Could not start conversation');
    }
  };

  const openNewChat = async () => {
    setNewChatModalOpen(true);
    try {
      const res = await api.getSuggestedUsers();
      setSuggestedUsers(res.users);
    } catch (e) {}
  };

  return (
    <div className="h-[calc(100dvh-98px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] md:h-[calc(100dvh-44px)] min-h-[360px] md:min-h-[500px] w-full glass-card rounded-3xl border border-white/10 overflow-hidden flex flex-col md:flex-row shadow-2xl">
      {/* ================= CONVERSATION LIST ================= */}
      <div
        className={`w-full md:w-72 lg:w-80 xl:w-96 shrink-0 min-h-0 border-b md:border-b-0 md:border-r border-white/10 flex flex-col bg-black/40 ${
          activeConvId ? 'hidden md:flex' : 'flex-1 md:flex-none flex'
        }`}
      >
        <div className="p-3.5 sm:p-4 md:p-5 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-base md:text-lg font-bold text-white tracking-wide">Direct Messages</h2>
          <button
            onClick={openNewChat}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
            title="New Conversation"
            aria-label="New conversation"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>
        </div>

        {/* Instagram-style 24h Notes Strip */}
        {currentUser && (() => {
          const myActiveNote = notes.find((n) => n.user_id === currentUser.id) || null;
          const otherNotes = notes.filter((n) => n.user_id !== currentUser.id);
          return (
            <div className="px-3.5 py-3 border-b border-white/10 bg-white/[0.02]">
              <div className="flex items-start gap-3 overflow-x-auto no-scrollbar pt-1">
                {/* Own Note */}
                <button
                  type="button"
                  onClick={() => {
                    soundFX.playTap();
                    setMyNoteText(myActiveNote?.text || '');
                    setMyNoteModalOpen(true);
                  }}
                  className="flex flex-col items-center gap-1 shrink-0 w-16 cursor-pointer group"
                >
                  <div className="relative pt-4">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10 px-2 py-0.5 rounded-full bg-zinc-900 border border-white/20 text-[9px] text-zinc-200 max-w-[68px] truncate shadow-md">
                      {myActiveNote ? myActiveNote.text : 'Note...'}
                    </div>
                    <div className="relative">
                      <Avatar
                        showPresence={false}
                        name={currentUser.display_name}
                        url={currentUser.avatar_url}
                        size="md"
                      />
                      <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-white text-black flex items-center justify-center shadow">
                        <Plus className="w-2.5 h-2.5 stroke-[3]" />
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] text-zinc-400 group-hover:text-white truncate w-full text-center">
                    Your note
                  </span>
                </button>

                {/* Other Users' Notes */}
                {otherNotes.map((n) => (
                  <button
                    key={n.user_id}
                    type="button"
                    onClick={() => {
                      soundFX.playTap();
                      setNoteReplyText('');
                      setSelectedNote(n);
                    }}
                    className="flex flex-col items-center gap-1 shrink-0 w-16 cursor-pointer group"
                  >
                    <div className="relative pt-4">
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10 px-2 py-0.5 rounded-full bg-white text-black font-medium text-[9px] max-w-[70px] truncate shadow-md">
                        {n.text}
                      </div>
                      <Avatar
                        userId={n.user_id}
                        name={n.display_name}
                        url={n.avatar_url}
                        size="md"
                      />
                    </div>
                    <span className="text-[10px] text-zinc-300 group-hover:text-white truncate w-full text-center">
                      {n.display_name.split(' ')[0]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Conversation Items */}
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-white/[0.04]">
          {loading && conversations.length === 0 ? (
            <div className="p-3 space-y-3">
              {[0, 1, 2].map((idx) => (
                <div key={idx} className="flex items-center gap-3 p-2 animate-pulse">
                  <div className="w-12 h-12 rounded-full bg-white/[0.08] shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-28 rounded-full bg-white/[0.08]" />
                    <div className="h-2.5 w-40 rounded-full bg-white/[0.05]" />
                  </div>
                </div>
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center flex flex-col items-center justify-center gap-3">
              <span className="text-sm text-zinc-400">No active discussions.</span>
              <button
                onClick={openNewChat}
                className="glass-button-primary px-4 py-2 text-xs font-semibold"
              >
                Start Conversation
              </button>
            </div>
          ) : (
            conversations.map((conv) => {
              const isSelected = conv.id === activeConvId;
              return (
                <div
                  key={conv.id}
                  onClick={() => {
                    soundFX.playTap();
                    setActiveConvId(conv.id);
                  }}
                  className={`p-3.5 sm:p-4 flex items-center gap-3.5 cursor-pointer transition-colors ${
                    isSelected ? 'bg-white/10' : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="relative shrink-0">
                    <Avatar
                      name={conv.display_name}
                      url={conv.avatar_url}
                      size="lg"
                    />
                    {onlineUsersMap[conv.other_id] && (
                      <span
                        title="Online"
                        aria-label="Online"
                        className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-black shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="text-sm font-semibold text-white truncate flex items-center gap-1">
                        {conv.display_name}
                        {conv.is_verified ? (
                          <Sparkles className="w-3 h-3 text-zinc-300 shrink-0" />
                        ) : null}
                      </div>
                      {conv.last_message_time && (
                        <span className="text-[10px] text-zinc-500 font-mono tabular-nums shrink-0">
                          {new Date(conv.last_message_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
                      <span className="truncate">
                        {formatChatPreview(conv.last_message_content)}
                      </span>
                      {conv.unread_count !== undefined && conv.unread_count > 0 && (
                        <span className="bg-white text-black text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full shrink-0">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ================= ACTIVE CHAT THREAD ================= */}
      <div
        className={`flex-1 min-w-0 min-h-0 flex flex-col bg-zinc-950/70 relative ${
          !activeConvId ? 'hidden md:flex items-center justify-center' : 'flex'
        }`}
      >
        {!activeConvId ? (
          <div className="text-center p-8 text-zinc-500 text-sm">
            Select a conversation or start a new dialogue.
          </div>
        ) : (
          <>
            {/* Thread Header */}
            <div className="h-14 md:h-[68px] shrink-0 px-3 sm:px-4 md:px-6 border-b border-white/10 flex items-center justify-between glass-nav z-10">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button
                  onClick={() => setActiveConvId(null)}
                  className="md:hidden w-10 h-10 flex items-center justify-center -ml-1 text-zinc-400 hover:text-white rounded-xl hover:bg-white/10 shrink-0"
                  aria-label="Back to conversations"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                {otherUser && (
                  <div
                    onClick={() => onOpenProfile(otherUser.username)}
                    className="flex items-center gap-3 cursor-pointer group min-w-0"
                  >
                    <div className="relative shrink-0">
                      <Avatar
                        name={otherUser.display_name}
                        url={otherUser.avatar_url}
                        size="sm"
                        className="group-hover:border-white transition"
                      />
                      {onlineUsersMap[otherUser.id] && (
                        <span
                          title="Online"
                          aria-label="Online"
                          className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-black shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white flex items-center gap-1 truncate">
                        <span className="truncate">{otherUser.display_name}</span>
                        {otherUser.is_verified ? (
                          <Sparkles className="w-3 h-3 text-zinc-300 shrink-0" />
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-mono truncate">
                        <span>@{otherUser.username}</span>
                        {onlineUsersMap[otherUser.id] && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-emerald-400 font-sans font-medium">Online</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Messages Scroll Area */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 md:p-6 flex flex-col gap-3.5">
              {(() => {
                const latestOwnMsgId = [...messages]
                  .reverse()
                  .find((msg) => msg.sender_id === currentUser?.id)?.id;

                return messages.map((m) => {
                  const isMe = m.sender_id === currentUser?.id;
                  const cleanText = cleanChatMessageText(m.content);
                  const msgReactions = reactions.filter((r) => r.message_id === m.id);
                  const isTemp = m.id.startsWith('temp_msg_');
                  const isSeenByOther =
                    isMe &&
                    m.id === latestOwnMsgId &&
                    otherLastReadAt &&
                    new Date(otherLastReadAt).getTime() >= new Date(m.created_at).getTime();

                  return (
                    <div
                      key={m.id}
                      className={`group/msg flex flex-col max-w-[85%] md:max-w-[75%] ${
                        isMe ? 'self-end items-end' : 'self-start items-start'
                      }`}
                    >
                      <div className={`flex items-end gap-1.5 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                        <div
                          className={`rounded-2xl px-3.5 sm:px-4 py-2.5 sm:py-3 text-sm md:text-[15px] relative ${
                            isMe
                              ? 'bg-white text-black font-medium rounded-br-xs shadow-md'
                              : 'glass-surface text-white rounded-bl-xs'
                          }`}
                        >
                          {/* Quoted Reply Strip */}
                          {m.reply_to_text && (
                            <div
                              className={`mb-2 pl-2.5 border-l-2 text-[11px] leading-snug ${
                                isMe
                                  ? 'border-black/35 text-zinc-700'
                                  : 'border-white/40 text-zinc-300'
                              }`}
                            >
                              <div className="font-semibold text-[10px]">
                                {m.reply_to_sender || 'Reply'}
                              </div>
                              <div className="line-clamp-2 opacity-85">{m.reply_to_text}</div>
                            </div>
                          )}

                          {/* Shared Post Preview Card */}
                          {m.shared_post_id && (
                            <div
                              onClick={() => {
                                soundFX.playTap();
                                if (onOpenPostId) onOpenPostId(m.shared_post_id!);
                              }}
                              className={`mb-2 rounded-xl overflow-hidden border cursor-pointer transition ${
                                isMe
                                  ? 'bg-black/5 border-black/15 hover:bg-black/10'
                                  : 'bg-white/[0.06] border-white/15 hover:bg-white/10'
                              }`}
                            >
                              {m.shared_post_image && !failedSharedImgs[m.id] && (
                                <img
                                  src={m.shared_post_image}
                                  alt="Shared post"
                                  loading="lazy"
                                  decoding="async"
                                  referrerPolicy="no-referrer"
                                  onError={() => setFailedSharedImgs((prev) => ({ ...prev, [m.id]: true }))}
                                  className="w-full max-w-[240px] h-32 object-cover"
                                />
                              )}
                              <div className="p-2.5">
                                <div className="text-[11px] font-semibold truncate">
                                  {m.shared_post_author || m.shared_post_username}
                                  {m.shared_post_username && (
                                    <span className="ml-1 opacity-70 font-mono">@{m.shared_post_username}</span>
                                  )}
                                </div>
                                {m.shared_post_text && (
                                  <p className="text-xs opacity-85 line-clamp-2 mt-0.5">
                                    {m.shared_post_text}
                                  </p>
                                )}
                                <span className="text-[10px] underline opacity-75 mt-1 inline-block">
                                  View Post
                                </span>
                              </div>
                            </div>
                          )}

                          {m.image_url && (
                            <div
                              className="relative group/img mb-2 rounded-xl overflow-hidden max-w-xs cursor-zoom-in"
                              onClick={() => {
                                soundFX.playTap();
                                setLightboxImage(m.image_url!);
                              }}
                            >
                              <img
                                src={m.image_url}
                                alt="Attachment"
                                loading="lazy"
                                decoding="async"
                                referrerPolicy="no-referrer"
                                className="w-full h-auto object-cover transition-transform duration-200 group-hover/img:scale-[1.02]"
                              />
                              <span className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-black/60 backdrop-blur-md text-white/90 flex items-center justify-center opacity-85 md:opacity-0 md:group-hover/img:opacity-100 transition pointer-events-none">
                                <ZoomIn className="w-3.5 h-3.5" />
                              </span>
                            </div>
                          )}
                          {cleanText && (
                            <div className="leading-relaxed whitespace-pre-wrap break-words">{cleanText}</div>
                          )}
                        </div>

                        {/* Message Actions Toolbar (Reply, React, Unsend) */}
                        {!isTemp && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="relative flex items-center gap-0.5 opacity-80 md:opacity-0 md:group-hover/msg:opacity-100 transition shrink-0"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setReplyingTo({
                                  id: m.id,
                                  text:
                                    cleanText ||
                                    (m.shared_post_id
                                      ? `Post by @${m.shared_post_username}`
                                      : 'Photo attachment'),
                                  sender: isMe
                                    ? currentUser?.display_name || 'You'
                                    : otherUser?.display_name || 'Member',
                                });
                              }}
                              title="Reply"
                              aria-label="Reply to message"
                              className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                            >
                              <Reply className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setReactionPickerMsgId((prev) => (prev === m.id ? null : m.id));
                              }}
                              title="React"
                              aria-label="React to message"
                              className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                            >
                              <SmilePlus className="w-3.5 h-3.5" />
                            </button>
                            {isMe && (
                              <button
                                type="button"
                                onClick={() => setMsgToUnsend(m)}
                                title="Unsend"
                                aria-label="Unsend message"
                                className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {reactionPickerMsgId === m.id && (
                              <div
                                className={`absolute bottom-9 ${
                                  isMe ? 'right-0' : 'left-0'
                                } z-30 flex items-center gap-1 px-2 py-1 rounded-full glass-surface border border-white/20 shadow-xl`}
                              >
                                {DM_QUICK_REACTIONS.map((emoji) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    aria-label={`React with ${emoji}`}
                                    onClick={() => handleReactMessage(m.id, emoji)}
                                    className="w-8 h-8 rounded-full hover:bg-white/15 flex items-center justify-center text-sm transition active:scale-90 cursor-pointer"
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Stacked Reactions Pills */}
                      {msgReactions.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 mt-1 px-1">
                          {Object.entries(
                            msgReactions.reduce<Record<string, { count: number; byMe: boolean }>>(
                              (acc, r) => {
                                if (!acc[r.emoji]) acc[r.emoji] = { count: 0, byMe: false };
                                acc[r.emoji].count += 1;
                                if (r.user_id === currentUser?.id) acc[r.emoji].byMe = true;
                                return acc;
                              },
                              {}
                            )
                          ).map(([emoji, info]) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => handleReactMessage(m.id, emoji)}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition cursor-pointer ${
                                info.byMe
                                  ? 'bg-white/20 border-white/40 text-white'
                                  : 'bg-white/[0.06] border-white/10 text-zinc-300 hover:bg-white/15'
                              }`}
                            >
                              <span>{emoji}</span>
                              {info.count > 1 && <span className="text-[10px] tabular-nums">{info.count}</span>}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-1.5 text-[10px] text-zinc-600 font-mono tabular-nums mt-1 px-1">
                        <span>
                          {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isSeenByOther && (
                          <span className="text-zinc-400 font-sans font-medium">· Seen</span>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}

              {otherTyping && (
                <div className="self-start inline-flex items-center gap-2 px-3.5 py-2 rounded-2xl glass-surface text-xs text-zinc-300 border border-white/10">
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 animate-bounce" />
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 animate-bounce [animation-delay:120ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 animate-bounce [animation-delay:240ms]" />
                  </span>
                  <span className="text-[11px] text-zinc-400">Typing...</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Composer Input Bar */}
            <form
              onSubmit={handleSendMessage}
              className="p-2.5 sm:p-3 md:p-4 border-t border-white/10 glass-surface flex flex-col gap-2"
            >
              {replyingTo && (
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-white/[0.05] border border-white/10 text-xs">
                  <div className="min-w-0">
                    <span className="text-zinc-400">Replying to </span>
                    <span className="font-semibold text-white">{replyingTo.sender}</span>
                    <p className="text-[11px] text-zinc-400 truncate">{replyingTo.text}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyingTo(null)}
                    aria-label="Cancel reply"
                    className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {attachedImage && (
                <div className="relative w-20 h-20 rounded-xl overflow-hidden border border-white/20">
                  <img
                    src={attachedImage}
                    alt="Preview"
                    referrerPolicy="no-referrer"
                    onError={() => setAttachedImage(null)}
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setAttachedImage(null)}
                    aria-label="Remove attached image"
                    className="absolute top-1 right-1 w-7 h-7 flex items-center justify-center bg-black/75 text-white rounded-full hover:bg-black cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-1.5 sm:gap-2">
                <label
                  title={uploadingImage ? 'Uploading image...' : 'Attach image'}
                  className={`w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 text-zinc-400 hover:text-white cursor-pointer transition shrink-0 ${uploadingImage ? 'opacity-50 animate-pulse' : ''}`}
                >
                  <ImageIcon className="w-5 h-5" />
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </label>

                <input
                  type="text"
                  value={inputText}
                  maxLength={1980}
                  onChange={(e) => handleTypingActivity(e.target.value)}
                  onBlur={() => {
                    if (activeConvId) api.setConversationTyping(activeConvId, false).catch(() => {});
                  }}
                  placeholder="Type a message..."
                  className="glass-input flex-1 min-w-0 px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-2xl text-sm"
                />

                <button
                  type="submit"
                  disabled={sending || uploadingImage || (!inputText.trim() && !attachedImage)}
                  aria-label="Send message"
                  className="glass-button-primary w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center rounded-full disabled:opacity-40 transition cursor-pointer shrink-0 shadow-sm"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      {/* ================= NEW CHAT USER PICKER MODAL ================= */}
      {newChatModalOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setNewChatModalOpen(false);
          }}
        >
          <div className="glass-surface w-full max-w-md rounded-3xl p-5 sm:p-6 border border-white/15 max-h-[85dvh] flex flex-col my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
              <h3 className="text-base font-semibold text-white">Start New Conversation</h3>
              <button
                type="button"
                onClick={() => setNewChatModalOpen(false)}
                aria-label="Close new conversation dialog"
                className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative mb-4">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search registered members..."
                className="glass-input w-full pl-10 pr-4 py-2.5 rounded-xl text-xs"
              />
            </div>

            <div className="max-h-60 overflow-y-auto flex flex-col gap-2">
              {suggestedUsers
                .filter(
                  (u) =>
                    u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    u.display_name.toLowerCase().includes(searchQuery.toLowerCase())
                )
                .map((u) => (
                  <div
                    key={u.id}
                    onClick={() => handleStartNewChat(u.id)}
                    className="flex items-center justify-between p-2.5 rounded-2xl hover:bg-white/10 cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar
                        userId={u.id}
                        name={u.display_name}
                        url={u.avatar_url}
                        size="sm"
                      />
                      <div>
                        <div className="text-xs font-semibold text-white flex items-center gap-1">
                          {u.display_name}
                          {u.is_verified ? (
                            <Sparkles className="w-3 h-3 text-zinc-300" />
                          ) : null}
                        </div>
                        <div className="text-[10px] text-zinc-500 font-mono">@{u.username}</div>
                      </div>
                    </div>
                    <span className="text-xs text-zinc-400 group-hover:text-white">Message</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Interactive Zoomable Chat Photo Lightbox */}
      <ZoomableImageLightbox
        src={lightboxImage}
        alt="Chat photo"
        onClose={() => setLightboxImage(null)}
      />

      {/* Own 24h Note Composer Modal */}
      {myNoteModalOpen && currentUser && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !savingNote) setMyNoteModalOpen(false);
          }}
          className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4"
        >
          <div className="glass-surface w-full max-w-sm rounded-3xl p-5 sm:p-6 border border-white/15 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
              <h3 className="text-sm font-semibold text-white">Your 24h Note</h3>
              <button
                type="button"
                onClick={() => !savingNote && setMyNoteModalOpen(false)}
                aria-label="Close note composer"
                className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-zinc-400 mb-3">
              Share a short 60-character thought visible at the top of Messages for 24 hours.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!myNoteText.trim() || savingNote) return;
                setSavingNote(true);
                try {
                  await api.setNote(myNoteText);
                  await loadNotes();
                  soundFX.playSuccess();
                  showToast('Note shared for 24 hours');
                  setMyNoteModalOpen(false);
                } catch {
                  showToast('Could not share note');
                } finally {
                  setSavingNote(false);
                }
              }}
              className="flex flex-col gap-3"
            >
              <input
                type="text"
                value={myNoteText}
                maxLength={60}
                onChange={(e) => setMyNoteText(e.target.value)}
                placeholder="Share what's on your mind..."
                className="glass-input w-full px-3.5 py-2.5 rounded-xl text-xs"
              />
              <div className="flex items-center justify-between text-[11px] text-zinc-500 tabular-nums">
                <span>{myNoteText.length}/60</span>
                <div className="flex items-center gap-2">
                  {notes.some((n) => n.user_id === currentUser.id) && (
                    <button
                      type="button"
                      disabled={savingNote}
                      onClick={async () => {
                        setSavingNote(true);
                        try {
                          await api.deleteNote();
                          setNotes((prev) => prev.filter((n) => n.user_id !== currentUser.id));
                          showToast('Note deleted');
                          setMyNoteModalOpen(false);
                        } catch {
                          showToast('Could not delete note');
                        } finally {
                          setSavingNote(false);
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl text-red-400 hover:bg-red-500/10 cursor-pointer"
                    >
                      Delete Note
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={savingNote || !myNoteText.trim()}
                    className="glass-button-primary px-4 py-1.5 text-xs font-semibold disabled:opacity-40 cursor-pointer"
                  >
                    {savingNote ? 'Saving...' : 'Share'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Friend Note Detail & Quick DM Reply Modal */}
      {selectedNote && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !sendingNoteReply) setSelectedNote(null);
          }}
          className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4"
        >
          <div className="glass-surface w-full max-w-sm rounded-3xl p-5 sm:p-6 border border-white/15 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
              <div
                onClick={() => {
                  const uname = selectedNote.username;
                  setSelectedNote(null);
                  onOpenProfile(uname);
                }}
                className="flex items-center gap-2.5 cursor-pointer min-w-0"
              >
                <Avatar
                  userId={selectedNote.user_id}
                  name={selectedNote.display_name}
                  url={selectedNote.avatar_url}
                  size="sm"
                />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{selectedNote.display_name}</div>
                  <div className="text-[10px] text-zinc-500 font-mono truncate">@{selectedNote.username}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNote(null)}
                aria-label="Close note"
                className="w-9 h-9 flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-white text-black text-sm font-medium text-center mb-4">
              &ldquo;{selectedNote.text}&rdquo;
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!noteReplyText.trim() || sendingNoteReply) return;
                setSendingNoteReply(true);
                try {
                  const res = await api.createConversation(selectedNote.user_id);
                  await api.sendMessage(
                    res.conversationId,
                    `Replied to your note ("${selectedNote.text}"):\n${noteReplyText.trim()}`,
                    null,
                    selectedNote.user_id
                  );
                  soundFX.playMessageSent();
                  setSelectedNote(null);
                  setActiveConvId(res.conversationId);
                  loadConversations();
                  showToast(`Replied to @${selectedNote.username}`);
                } catch {
                  showToast('Could not send reply');
                } finally {
                  setSendingNoteReply(false);
                }
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={noteReplyText}
                onChange={(e) => setNoteReplyText(e.target.value)}
                placeholder={`Reply to @${selectedNote.username}'s note...`}
                className="glass-input flex-1 px-3.5 py-2.5 rounded-xl text-xs"
              />
              <button
                type="submit"
                disabled={sendingNoteReply || !noteReplyText.trim()}
                aria-label="Send note reply"
                className="glass-button-primary w-10 h-10 flex items-center justify-center rounded-full disabled:opacity-40 cursor-pointer shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}

      <WarningPopup
        open={!!msgToUnsend}
        title="Unsend message?"
        message="This message will be permanently removed from the conversation."
        confirmLabel="Unsend"
        tone="danger"
        onCancel={() => setMsgToUnsend(null)}
        onConfirm={() => {
          const target = msgToUnsend;
          setMsgToUnsend(null);
          if (target) handleUnsendMessage(target);
        }}
      />
    </div>
  );
};
