export interface User {
  id: string;
  username: string;
  email?: string;
  display_name: string;
  bio: string;
  avatar_url: string;
  banner_url?: string;
  website?: string;
  location?: string;
  is_verified: boolean | number;
  is_private: boolean | number;
  created_at?: string;
  posts_count?: number;
  followers_count?: number;
  following_count?: number;
  is_following?: boolean;
  is_pending_request?: boolean;
  is_blocked_by_me?: boolean;
  mutual_followers?: Array<{
    username: string;
    avatar_url: string;
    display_name: string;
  }>;
}

export interface Post {
  id: string;
  user_id: string;
  content: string;
  images: string[];
  likes_count: number;
  comments_count: number;
  reposts_count?: number;
  is_repost?: boolean;
  repost_of_id?: string | null;
  repost_of_user?: string | null;
  repost_of_display_name?: string | null;
  repost_of_content?: string | null;
  repost_of_image?: string | null;
  is_pinned?: boolean;
  pinned_at?: string | null;
  hide_likes?: boolean;
  comments_disabled?: boolean;
  mentions?: string[];
  created_at: string;
  updated_at?: string;
  username: string;
  display_name: string;
  avatar_url: string;
  is_verified: boolean | number;
  is_liked: boolean;
  is_bookmarked: boolean;
}

export interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  parent_id?: string | null;
  content: string;
  likes_count: number;
  is_liked?: boolean;
  created_at: string;
  username: string;
  display_name: string;
  avatar_url: string;
  is_verified: boolean | number;
}

export interface Story {
  id: string;
  imageUrl: string;
  caption?: string;
  tags?: string[];
  audience?: 'everyone' | 'close_friends';
  createdAt: string;
  expiresAt: string;
  isViewed: boolean;
}

export interface StoryGroup {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  isVerified: boolean;
  hasUnviewed: boolean;
  hasCloseFriends?: boolean;
  stories: Story[];
}

export interface StoryViewer {
  user: User;
  viewed_at: string;
}

export interface StoryHighlight {
  id: string;
  user_id: string;
  title: string;
  cover_url: string;
  created_at: string;
  updated_at: string;
  items?: StoryHighlightItem[];
}

export interface StoryHighlightItem {
  id: string;
  highlight_id: string;
  user_id: string;
  image_url: string;
  caption: string;
  tags?: string[];
  created_at: string;
}

export interface Note {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  is_verified: boolean;
  text: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  updated_at: string;
  other_id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  is_verified: boolean | number;
  last_message_content?: string;
  last_message_time?: string;
  last_message_sender?: string;
  unread_count?: number;
}

export interface MessageReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  image_url?: string | null;
  reply_to_id?: string | null;
  reply_to_text?: string | null;
  reply_to_sender?: string | null;
  shared_post_id?: string | null;
  shared_post_author?: string | null;
  shared_post_username?: string | null;
  shared_post_text?: string | null;
  shared_post_image?: string | null;
  reactions?: Array<{ user_id: string; emoji: string }>;
  created_at: string;
  username?: string;
  display_name?: string;
  avatar_url?: string;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  actor_id: string;
  type:
    | 'like'
    | 'comment'
    | 'reply'
    | 'follow'
    | 'follow_request'
    | 'message'
    | 'welcome'
    | 'repost'
    | 'quote'
    | 'story_tag'
    | 'mention';
  target_id: string;
  read: number;
  created_at: string;
  actor_username: string;
  actor_display_name: string;
  actor_avatar_url: string;
  actor_verified: number;
}

export interface FollowRequest {
  id: string;
  requester_id: string;
  created_at: string;
  username: string;
  display_name: string;
  avatar_url: string;
  bio: string;
}

export interface LeaderboardEntry {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  is_verified: boolean;
  points: number;
  daily_unlocked_day: string;
  streak_days: number;
  interactions_count: number;
  updated_at: string;
}

export interface SavedAccount {
  uid: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url: string;
  is_verified?: boolean;
  lastUsedAt: number;
}
