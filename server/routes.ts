import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { eventManager } from './events.js';
import path from 'path';
import fs from 'fs';
import { ZipArchive } from 'archiver';

export const apiRouter = Router();

// Uploads directory
const UPLOADS_DIR = path.resolve(process.cwd(), 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Auth Middleware
export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    email: string;
    display_name: string;
    avatar_url: string;
    is_private: number;
    is_verified: number;
  };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.substring(7);
  const session = db.prepare(`
    SELECT s.user_id, u.id, u.username, u.email, u.display_name, u.avatar_url, u.is_private, u.is_verified
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
  `).get(token) as any;

  if (!session) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired session' });
  }

  req.user = session;
  next();
}

export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const session = db.prepare(`
      SELECT s.user_id, u.id, u.username, u.email, u.display_name, u.avatar_url, u.is_private, u.is_verified
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
    `).get(token) as any;
    if (session) {
      req.user = session;
    }
  }
  next();
}

// Real-Time Server Sent Events
apiRouter.get('/events', (req: Request, res: Response) => {
  const token = req.query.token as string;
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  const session = db.prepare(`
    SELECT user_id FROM sessions WHERE token = ? AND datetime(expires_at) > datetime('now')
  `).get(token) as any;

  if (!session) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  eventManager.addClient(session.user_id, res);
  res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected' })}\n\n`);
});

// ======================== AUTH ROUTES ========================

apiRouter.post('/auth/register', (req: Request, res: Response) => {
  const { username, email, password, display_name } = req.body;

  if (!username || !email || !password || !display_name) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');
  if (cleanUsername.length < 3 || cleanUsername.length > 20) {
    return res.status(400).json({ error: 'Username must be between 3 and 20 alphanumeric characters.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(cleanUsername, email.toLowerCase().trim());
  if (existing) {
    return res.status(409).json({ error: 'Username or email already in use.' });
  }

  const userId = 'usr_' + crypto.randomUUID().slice(0, 8);
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);

  const avatarUrl = '';

  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, display_name, avatar_url, bio)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, cleanUsername, email.toLowerCase().trim(), passwordHash, display_name.trim(), avatarUrl, 'Member of SYNC.');

  // Create session
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);

  // Send a welcome notification
  db.prepare(`
    INSERT INTO notifications (id, user_id, actor_id, type, target_id, read)
    VALUES (?, ?, ?, 'welcome', ?, 0)
  `).run('notif_' + crypto.randomUUID().slice(0, 8), userId, userId, 'welcome_noir');

  const user = db.prepare('SELECT id, username, email, display_name, bio, avatar_url, banner_url, website, location, is_verified, is_private, created_at FROM users WHERE id = ?').get(userId);

  return res.json({ token, user });
});

apiRouter.post('/auth/login', (req: Request, res: Response) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Username/email and password required.' });
  }

  const user = db.prepare(`
    SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE
  `).get(identifier.trim(), identifier.trim()) as any;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email/username or password.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, expiresAt);

  delete user.password_hash;
  return res.json({ token, user });
});

apiRouter.post('/auth/logout', authMiddleware, (req: AuthRequest, res: Response) => {
  const authHeader = req.headers.authorization!;
  const token = authHeader.substring(7);
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  return res.json({ success: true });
});

apiRouter.get('/auth/me', authMiddleware, (req: AuthRequest, res: Response) => {
  const user = db.prepare(`
    SELECT id, username, email, display_name, bio, avatar_url, banner_url, website, location, is_verified, is_private, created_at
    FROM users WHERE id = ?
  `).get(req.user!.id) as any;

  if (!user) return res.status(404).json({ error: 'User not found' });

  const unreadNotifs = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0').get(req.user!.id) as any;
  const unreadMessages = db.prepare(`
    SELECT COUNT(m.id) as count
    FROM messages m
    JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
    WHERE cm.user_id = ? AND m.sender_id != ? AND datetime(m.created_at) > datetime(cm.last_read_at)
  `).get(req.user!.id, req.user!.id) as any;

  return res.json({
    user,
    counts: {
      unreadNotifications: unreadNotifs.count,
      unreadMessages: unreadMessages.count,
    }
  });
});

apiRouter.put('/auth/profile', authMiddleware, (req: AuthRequest, res: Response) => {
  const { display_name, bio, website, location, avatar_url, banner_url, is_private } = req.body;

  db.prepare(`
    UPDATE users
    SET display_name = COALESCE(?, display_name),
        bio = COALESCE(?, bio),
        website = COALESCE(?, website),
        location = COALESCE(?, location),
        avatar_url = COALESCE(?, avatar_url),
        banner_url = COALESCE(?, banner_url),
        is_private = COALESCE(?, is_private),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(display_name, bio, website, location, avatar_url, banner_url, is_private !== undefined ? (is_private ? 1 : 0) : null, req.user!.id);

  const updated = db.prepare('SELECT id, username, email, display_name, bio, avatar_url, banner_url, website, location, is_verified, is_private, created_at FROM users WHERE id = ?').get(req.user!.id);
  return res.json({ user: updated });
});

apiRouter.post('/auth/reset-password-request', (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const user = db.prepare('SELECT id, email FROM users WHERE email = ? COLLATE NOCASE').get(email) as any;
  if (user) {
    // In production this sends a reset link; for our full-stack app, simulate verification instructions
    return res.json({ message: 'Password reset link sent to your email address.' });
  }
  return res.json({ message: 'If this email is registered, instructions have been sent.' });
});

// Image upload handling (Base64 or Data URI support)
apiRouter.post('/upload', authMiddleware, (req: AuthRequest, res: Response) => {
  const { data, filename } = req.body;
  if (!data) return res.status(400).json({ error: 'No image data provided' });

  // Handle data URI
  const matches = data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    // If it's already a URL, return it
    if (data.startsWith('http://') || data.startsWith('https://')) {
      return res.json({ url: data });
    }
    return res.status(400).json({ error: 'Invalid base64 image data' });
  }

  const ext = matches[1].split('/')[1] || 'jpg';
  const buffer = Buffer.from(matches[2], 'base64');
  const safeName = `img_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const filePath = path.join(UPLOADS_DIR, safeName);

  fs.writeFileSync(filePath, buffer);
  return res.json({ url: `/uploads/${safeName}` });
});

// ======================== POSTS & FEED ========================

apiRouter.get('/posts', optionalAuth, (req: AuthRequest, res: Response) => {
  const feed = (req.query.feed as string) || 'for_you';
  const tag = req.query.tag as string;
  const currentUserId = req.user?.id;

  let query = `
    SELECT p.*,
           u.username, u.display_name, u.avatar_url, u.is_verified,
           (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as likes_count,
           (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comments_count,
           CASE WHEN ? IS NOT NULL AND EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) THEN 1 ELSE 0 END as is_liked,
           CASE WHEN ? IS NOT NULL AND EXISTS (SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = ?) THEN 1 ELSE 0 END as is_bookmarked
    FROM posts p
    JOIN users u ON u.id = p.user_id
  `;

  const conditions: string[] = [];
  const params: any[] = [currentUserId, currentUserId, currentUserId, currentUserId];

  // Filter blocked users if logged in
  if (currentUserId) {
    conditions.push(`p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)`);
    conditions.push(`p.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)`);
    params.push(currentUserId, currentUserId);
  }

  if (tag) {
    conditions.push(`p.content LIKE ?`);
    params.push(`%#${tag.replace('#', '')}%`);
  }

  if (feed === 'following' && currentUserId) {
    conditions.push(`(p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?) OR p.user_id = ?)`);
    params.push(currentUserId, currentUserId);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY p.created_at DESC LIMIT 50';

  const rows = db.prepare(query).all(...params) as any[];
  const posts = rows.map(r => ({
    ...r,
    images: JSON.parse(r.images_json || '[]'),
    is_liked: !!r.is_liked,
    is_bookmarked: !!r.is_bookmarked,
  }));

  return res.json({ posts });
});

apiRouter.post('/posts', authMiddleware, (req: AuthRequest, res: Response) => {
  const { content, images } = req.body;
  if (!content && (!images || images.length === 0)) {
    return res.status(400).json({ error: 'Post must have content or images' });
  }

  const postId = 'post_' + crypto.randomUUID().slice(0, 10);
  const imagesJson = JSON.stringify(images || []);

  db.prepare(`
    INSERT INTO posts (id, user_id, content, images_json, likes_count, comments_count)
    VALUES (?, ?, ?, ?, 0, 0)
  `).run(postId, req.user!.id, content || '', imagesJson);

  const post = db.prepare(`
    SELECT p.*,
           u.username, u.display_name, u.avatar_url, u.is_verified,
           0 as likes_count, 0 as comments_count, 0 as is_liked, 0 as is_bookmarked
    FROM posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.id = ?
  `).get(postId) as any;

  post.images = JSON.parse(post.images_json || '[]');
  post.is_liked = false;
  post.is_bookmarked = false;

  eventManager.broadcast('new_post', { post });

  return res.status(201).json({ post });
});

apiRouter.get('/posts/:id', optionalAuth, (req: AuthRequest, res: Response) => {
  const currentUserId = req.user?.id;
  const post = db.prepare(`
    SELECT p.*,
           u.username, u.display_name, u.avatar_url, u.is_verified,
           (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as likes_count,
           (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comments_count,
           CASE WHEN ? IS NOT NULL AND EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) THEN 1 ELSE 0 END as is_liked,
           CASE WHEN ? IS NOT NULL AND EXISTS (SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = ?) THEN 1 ELSE 0 END as is_bookmarked
    FROM posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.id = ?
  `).get(currentUserId, currentUserId, currentUserId, currentUserId, req.params.id) as any;

  if (!post) return res.status(404).json({ error: 'Post not found' });

  post.images = JSON.parse(post.images_json || '[]');
  post.is_liked = !!post.is_liked;
  post.is_bookmarked = !!post.is_bookmarked;

  return res.json({ post });
});

apiRouter.put('/posts/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  const { content } = req.body;
  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(req.params.id) as any;
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.user_id !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });

  db.prepare('UPDATE posts SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(content, req.params.id);
  return res.json({ success: true, content });
});

apiRouter.delete('/posts/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(req.params.id) as any;
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.user_id !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });

  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  return res.json({ success: true });
});

// Like / Unlike Post
apiRouter.post('/posts/:id/like', authMiddleware, (req: AuthRequest, res: Response) => {
  const postId = req.params.id;
  const userId = req.user!.id;

  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(postId) as any;
  if (!post) return res.status(404).json({ error: 'Post not found' });

  try {
    const likeId = 'lik_' + crypto.randomUUID().slice(0, 8);
    db.prepare('INSERT INTO likes (id, user_id, post_id) VALUES (?, ?, ?)').run(likeId, userId, postId);
    db.prepare('UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?').run(postId);

    // Create notification if liking someone else's post
    if (post.user_id !== userId) {
      const notifId = 'notif_' + crypto.randomUUID().slice(0, 8);
      db.prepare(`
        INSERT INTO notifications (id, user_id, actor_id, type, target_id)
        VALUES (?, ?, ?, 'like', ?)
      `).run(notifId, post.user_id, userId, postId);

      eventManager.sendToUser(post.user_id, 'notification', {
        type: 'like',
        actor: req.user,
        postId
      });
    }

    return res.json({ liked: true });
  } catch (err: any) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.json({ liked: true });
    }
    return res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/posts/:id/like', authMiddleware, (req: AuthRequest, res: Response) => {
  const postId = req.params.id;
  const userId = req.user!.id;

  const resInfo = db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(userId, postId);
  if (resInfo.changes > 0) {
    db.prepare('UPDATE posts SET likes_count = MAX(0, likes_count - 1) WHERE id = ?').run(postId);
  }
  return res.json({ liked: false });
});

apiRouter.get('/posts/:id/likes', (req: Request, res: Response) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_verified, u.bio
    FROM likes l
    JOIN users u ON u.id = l.user_id
    WHERE l.post_id = ?
    ORDER BY l.created_at DESC
  `).all(req.params.id);

  return res.json({ users });
});

// Bookmarks
apiRouter.post('/posts/:id/bookmark', authMiddleware, (req: AuthRequest, res: Response) => {
  const postId = req.params.id;
  const userId = req.user!.id;

  try {
    const bId = 'bmk_' + crypto.randomUUID().slice(0, 8);
    db.prepare('INSERT INTO bookmarks (id, user_id, post_id) VALUES (?, ?, ?)').run(bId, userId, postId);
    return res.json({ bookmarked: true });
  } catch (err) {
    return res.json({ bookmarked: true });
  }
});

apiRouter.delete('/posts/:id/bookmark', authMiddleware, (req: AuthRequest, res: Response) => {
  const postId = req.params.id;
  const userId = req.user!.id;
  db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?').run(userId, postId);
  return res.json({ bookmarked: false });
});

apiRouter.get('/bookmarks', authMiddleware, (req: AuthRequest, res: Response) => {
  const rows = db.prepare(`
    SELECT p.*,
           u.username, u.display_name, u.avatar_url, u.is_verified,
           (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as likes_count,
           (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comments_count,
           1 as is_bookmarked,
           EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) as is_liked
    FROM bookmarks b
    JOIN posts p ON p.id = b.post_id
    JOIN users u ON u.id = p.user_id
    WHERE b.user_id = ?
    ORDER BY b.created_at DESC
  `).all(req.user!.id, req.user!.id) as any[];

  const posts = rows.map(r => ({
    ...r,
    images: JSON.parse(r.images_json || '[]'),
    is_liked: !!r.is_liked,
    is_bookmarked: true,
  }));

  return res.json({ posts });
});

// Comments
apiRouter.get('/posts/:id/comments', optionalAuth, (req: AuthRequest, res: Response) => {
  const currentUserId = req.user?.id;
  const comments = db.prepare(`
    SELECT c.*,
           u.username, u.display_name, u.avatar_url, u.is_verified
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.post_id = ?
    ORDER BY c.created_at ASC
  `).all(req.params.id) as any[];

  return res.json({ comments });
});

apiRouter.post('/posts/:id/comments', authMiddleware, (req: AuthRequest, res: Response) => {
  const { content, parent_id } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Comment content cannot be empty' });
  }

  const postId = req.params.id;
  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(postId) as any;
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const cmtId = 'cmt_' + crypto.randomUUID().slice(0, 8);
  db.prepare(`
    INSERT INTO comments (id, post_id, user_id, parent_id, content)
    VALUES (?, ?, ?, ?, ?)
  `).run(cmtId, postId, req.user!.id, parent_id || null, content.trim());

  db.prepare('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?').run(postId);

  // Notify post owner
  if (post.user_id !== req.user!.id) {
    const notifId = 'notif_' + crypto.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT INTO notifications (id, user_id, actor_id, type, target_id)
      VALUES (?, ?, ?, 'comment', ?)
    `).run(notifId, post.user_id, req.user!.id, postId);

    eventManager.sendToUser(post.user_id, 'notification', {
      type: 'comment',
      actor: req.user,
      postId,
      content: content.trim()
    });
  }

  // If reply, notify parent comment author
  if (parent_id) {
    const parent = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(parent_id) as any;
    if (parent && parent.user_id !== req.user!.id && parent.user_id !== post.user_id) {
      const notifId = 'notif_' + crypto.randomUUID().slice(0, 8);
      db.prepare(`
        INSERT INTO notifications (id, user_id, actor_id, type, target_id)
        VALUES (?, ?, ?, 'reply', ?)
      `).run(notifId, parent.user_id, req.user!.id, postId);

      eventManager.sendToUser(parent.user_id, 'notification', {
        type: 'reply',
        actor: req.user,
        postId
      });
    }
  }

  const createdComment = db.prepare(`
    SELECT c.*, u.username, u.display_name, u.avatar_url, u.is_verified
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.id = ?
  `).get(cmtId);

  return res.status(201).json({ comment: createdComment });
});

apiRouter.delete('/comments/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  const comment = db.prepare('SELECT post_id, user_id FROM comments WHERE id = ?').get(req.params.id) as any;
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  if (comment.user_id !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });

  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  db.prepare('UPDATE posts SET comments_count = MAX(0, comments_count - 1) WHERE id = ?').run(comment.post_id);

  return res.json({ success: true });
});

// ======================== PROFILES & USERS ========================

apiRouter.get('/users/suggested', optionalAuth, (req: AuthRequest, res: Response) => {
  const currentUserId = req.user?.id || '';

  const suggested = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.is_verified,
           (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) as followers_count,
           CASE WHEN ? != '' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = u.id) THEN 1 ELSE 0 END as is_following
    FROM users u
    WHERE u.id != ?
    ORDER BY followers_count DESC
    LIMIT 10
  `).all(currentUserId, currentUserId, currentUserId) as any[];

  return res.json({ users: suggested.map(u => ({ ...u, is_following: !!u.is_following })) });
});

apiRouter.get('/users/search', optionalAuth, (req: AuthRequest, res: Response) => {
  const q = ((req.query.q as string) || '').trim();
  const queryTerm = `%${q}%`;
  const users = db.prepare(`
    SELECT id, username, display_name, avatar_url, bio, is_verified
    FROM users
    WHERE username LIKE ? OR display_name LIKE ?
    LIMIT 15
  `).all(queryTerm, queryTerm);
  return res.json({ users });
});

apiRouter.get('/users/:username', optionalAuth, (req: AuthRequest, res: Response) => {
  const currentUserId = req.user?.id || '';
  const profile = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.bio, u.avatar_url, u.banner_url, u.website, u.location,
           u.is_verified, u.is_private, u.created_at,
           (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) as posts_count,
           (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) as followers_count,
           (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) as following_count,
           CASE WHEN ? != '' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = u.id) THEN 1 ELSE 0 END as is_following,
           CASE WHEN ? != '' AND EXISTS (SELECT 1 FROM follow_requests fr WHERE fr.requester_id = ? AND fr.target_id = u.id AND fr.status = 'pending') THEN 1 ELSE 0 END as is_pending_request,
           CASE WHEN ? != '' AND EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = ? AND b.blocked_id = u.id) THEN 1 ELSE 0 END as is_blocked_by_me
    FROM users u
    WHERE u.username = ? COLLATE NOCASE
  `).get(currentUserId, currentUserId, currentUserId, currentUserId, currentUserId, currentUserId, req.params.username) as any;

  if (!profile) return res.status(404).json({ error: 'User profile not found' });

  // Mutual followers check
  let mutualFollowers: any[] = [];
  if (currentUserId && currentUserId !== profile.id) {
    mutualFollowers = db.prepare(`
      SELECT u.username, u.avatar_url, u.display_name
      FROM follows f1
      JOIN follows f2 ON f1.following_id = f2.follower_id
      JOIN users u ON u.id = f1.following_id
      WHERE f1.follower_id = ? AND f2.following_id = ?
      LIMIT 3
    `).all(currentUserId, profile.id);
  }

  return res.json({
    user: {
      ...profile,
      is_following: !!profile.is_following,
      is_pending_request: !!profile.is_pending_request,
      is_blocked_by_me: !!profile.is_blocked_by_me,
      mutual_followers: mutualFollowers
    }
  });
});

apiRouter.get('/users/:username/posts', optionalAuth, (req: AuthRequest, res: Response) => {
  const currentUserId = req.user?.id || '';
  const user = db.prepare('SELECT id, is_private FROM users WHERE username = ? COLLATE NOCASE').get(req.params.username) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });

  // If private and not following and not self
  if (user.is_private && user.id !== currentUserId) {
    const isFollowing = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(currentUserId, user.id);
    if (!isFollowing) {
      return res.status(403).json({ error: 'Account is private. Follow this account to see their posts.' });
    }
  }

  const rows = db.prepare(`
    SELECT p.*,
           u.username, u.display_name, u.avatar_url, u.is_verified,
           (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as likes_count,
           (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comments_count,
           CASE WHEN ? != '' AND EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) THEN 1 ELSE 0 END as is_liked,
           CASE WHEN ? != '' AND EXISTS (SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = ?) THEN 1 ELSE 0 END as is_bookmarked
    FROM posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(currentUserId, currentUserId, currentUserId, currentUserId, user.id) as any[];

  const posts = rows.map(r => ({
    ...r,
    images: JSON.parse(r.images_json || '[]'),
    is_liked: !!r.is_liked,
    is_bookmarked: !!r.is_bookmarked
  }));

  return res.json({ posts });
});

apiRouter.get('/users/:username/likes', optionalAuth, (req: AuthRequest, res: Response) => {
  const currentUserId = req.user?.id || '';
  const user = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(req.params.username) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });

  const rows = db.prepare(`
    SELECT p.*,
           u.username, u.display_name, u.avatar_url, u.is_verified,
           (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as likes_count,
           (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comments_count,
           1 as is_liked,
           CASE WHEN ? != '' AND EXISTS (SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = ?) THEN 1 ELSE 0 END as is_bookmarked
    FROM likes lk
    JOIN posts p ON p.id = lk.post_id
    JOIN users u ON u.id = p.user_id
    WHERE lk.user_id = ?
    ORDER BY lk.created_at DESC
  `).all(currentUserId, currentUserId, user.id) as any[];

  const posts = rows.map(r => ({
    ...r,
    images: JSON.parse(r.images_json || '[]'),
    is_liked: true,
    is_bookmarked: !!r.is_bookmarked
  }));

  return res.json({ posts });
});

apiRouter.get('/users/:username/followers', (req: Request, res: Response) => {
  const user = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(req.params.username) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });

  const followers = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_verified, u.bio
    FROM follows f
    JOIN users u ON u.id = f.follower_id
    WHERE f.following_id = ?
    ORDER BY f.created_at DESC
  `).all(user.id);

  return res.json({ users: followers });
});

apiRouter.get('/users/:username/following', (req: Request, res: Response) => {
  const user = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(req.params.username) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });

  const following = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_verified, u.bio
    FROM follows f
    JOIN users u ON u.id = f.following_id
    WHERE f.follower_id = ?
    ORDER BY f.created_at DESC
  `).all(user.id);

  return res.json({ users: following });
});

// Follow / Unfollow
apiRouter.post('/users/:id/follow', authMiddleware, (req: AuthRequest, res: Response) => {
  const targetId = req.params.id;
  const currentUserId = req.user!.id;

  if (targetId === currentUserId) {
    return res.status(400).json({ error: 'Cannot follow yourself' });
  }

  const target = db.prepare('SELECT id, is_private FROM users WHERE id = ?').get(targetId) as any;
  if (!target) return res.status(404).json({ error: 'User not found' });

  if (target.is_private) {
    // Follow request
    const frId = 'fr_' + crypto.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT OR REPLACE INTO follow_requests (id, requester_id, target_id, status)
      VALUES (?, ?, ?, 'pending')
    `).run(frId, currentUserId, targetId);

    const notifId = 'notif_' + crypto.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT INTO notifications (id, user_id, actor_id, type, target_id)
      VALUES (?, ?, ?, 'follow_request', ?)
    `).run(notifId, targetId, currentUserId, frId);

    eventManager.sendToUser(targetId, 'notification', {
      type: 'follow_request',
      actor: req.user
    });

    return res.json({ status: 'requested' });
  }

  const folId = 'fol_' + crypto.randomUUID().slice(0, 8);
  try {
    db.prepare('INSERT INTO follows (id, follower_id, following_id) VALUES (?, ?, ?)').run(folId, currentUserId, targetId);
    
    // Notify target
    const notifId = 'notif_' + crypto.randomUUID().slice(0, 8);
    db.prepare(`
      INSERT INTO notifications (id, user_id, actor_id, type, target_id)
      VALUES (?, ?, ?, 'follow', ?)
    `).run(notifId, targetId, currentUserId, folId);

    eventManager.sendToUser(targetId, 'notification', {
      type: 'follow',
      actor: req.user
    });

    return res.json({ status: 'following' });
  } catch (err: any) {
    return res.json({ status: 'following' });
  }
});

apiRouter.delete('/users/:id/follow', authMiddleware, (req: AuthRequest, res: Response) => {
  const targetId = req.params.id;
  const currentUserId = req.user!.id;

  db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(currentUserId, targetId);
  db.prepare('DELETE FROM follow_requests WHERE requester_id = ? AND target_id = ?').run(currentUserId, targetId);

  return res.json({ status: 'unfollowed' });
});

// Follow Requests management
apiRouter.get('/follow-requests', authMiddleware, (req: AuthRequest, res: Response) => {
  const requests = db.prepare(`
    SELECT fr.id, fr.requester_id, fr.created_at,
           u.username, u.display_name, u.avatar_url, u.bio
    FROM follow_requests fr
    JOIN users u ON u.id = fr.requester_id
    WHERE fr.target_id = ? AND fr.status = 'pending'
    ORDER BY fr.created_at DESC
  `).all(req.user!.id);

  return res.json({ requests });
});

apiRouter.post('/follow-requests/:id/accept', authMiddleware, (req: AuthRequest, res: Response) => {
  const fr = db.prepare('SELECT * FROM follow_requests WHERE id = ? AND target_id = ?').get(req.params.id, req.user!.id) as any;
  if (!fr) return res.status(404).json({ error: 'Request not found' });

  db.prepare('DELETE FROM follow_requests WHERE id = ?').run(req.params.id);
  const folId = 'fol_' + crypto.randomUUID().slice(0, 8);
  db.prepare('INSERT OR IGNORE INTO follows (id, follower_id, following_id) VALUES (?, ?, ?)').run(folId, fr.requester_id, req.user!.id);

  return res.json({ success: true });
});

apiRouter.post('/follow-requests/:id/reject', authMiddleware, (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM follow_requests WHERE id = ? AND target_id = ?').run(req.params.id, req.user!.id);
  return res.json({ success: true });
});

// Block / Unblock
apiRouter.post('/users/:id/block', authMiddleware, (req: AuthRequest, res: Response) => {
  const targetId = req.params.id;
  const currentUserId = req.user!.id;
  if (targetId === currentUserId) return res.status(400).json({ error: 'Cannot block self' });

  // Remove follows both ways
  db.prepare('DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)').run(currentUserId, targetId, targetId, currentUserId);

  const blockId = 'blk_' + crypto.randomUUID().slice(0, 8);
  db.prepare('INSERT OR IGNORE INTO blocks (id, blocker_id, blocked_id) VALUES (?, ?, ?)').run(blockId, currentUserId, targetId);

  return res.json({ blocked: true });
});

apiRouter.delete('/users/:id/block', authMiddleware, (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user!.id, req.params.id);
  return res.json({ blocked: false });
});

apiRouter.get('/users-blocked', authMiddleware, (req: AuthRequest, res: Response) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_url
    FROM blocks b
    JOIN users u ON u.id = b.blocked_id
    WHERE b.blocker_id = ?
  `).all(req.user!.id);
  return res.json({ users });
});

// Search
apiRouter.get('/search', optionalAuth, (req: AuthRequest, res: Response) => {
  const q = ((req.query.q as string) || '').trim();
  if (!q) {
    // Return trending hashtags
    const hashtags = [
      { tag: 'noir', count: 142 },
      { tag: 'minimalism', count: 98 },
      { tag: 'architecture', count: 76 },
      { tag: 'monochrome', count: 64 },
      { tag: 'craft', count: 42 },
      { tag: 'tokyo', count: 39 },
      { tag: 'industrialdesign', count: 31 }
    ];
    return res.json({ users: [], posts: [], hashtags });
  }

  const queryTerm = `%${q.replace('#', '')}%`;

  const users = db.prepare(`
    SELECT id, username, display_name, avatar_url, bio, is_verified
    FROM users
    WHERE username LIKE ? OR display_name LIKE ?
    LIMIT 10
  `).all(queryTerm, queryTerm);

  const posts = db.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar_url, u.is_verified,
           (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as likes_count,
           (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comments_count
    FROM posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.content LIKE ?
    ORDER BY p.created_at DESC
    LIMIT 20
  `).all(queryTerm) as any[];

  return res.json({
    users,
    posts: posts.map(p => ({ ...p, images: JSON.parse(p.images_json || '[]') })),
    hashtags: []
  });
});

// ======================== STORIES ========================

apiRouter.get('/stories', optionalAuth, (req: AuthRequest, res: Response) => {
  const currentUserId = req.user?.id || '';

  // Get active stories not expired
  const rows = db.prepare(`
    SELECT s.*,
           u.username, u.display_name, u.avatar_url, u.is_verified,
           CASE WHEN ? != '' AND EXISTS (SELECT 1 FROM story_views sv WHERE sv.story_id = s.id AND sv.user_id = ?) THEN 1 ELSE 0 END as is_viewed
    FROM stories s
    JOIN users u ON u.id = s.user_id
    WHERE datetime(s.expires_at) > datetime('now')
    ORDER BY s.created_at ASC
  `).all(currentUserId, currentUserId) as any[];

  // Group by user
  const userMap = new Map<string, any>();
  for (const item of rows) {
    if (!userMap.has(item.user_id)) {
      userMap.set(item.user_id, {
        userId: item.user_id,
        username: item.username,
        displayName: item.display_name,
        avatarUrl: item.avatar_url,
        isVerified: !!item.is_verified,
        hasUnviewed: false,
        stories: []
      });
    }
    const userGroup = userMap.get(item.user_id)!;
    if (!item.is_viewed) {
      userGroup.hasUnviewed = true;
    }
    userGroup.stories.push({
      id: item.id,
      imageUrl: item.image_url,
      caption: item.caption,
      createdAt: item.created_at,
      expiresAt: item.expires_at,
      isViewed: !!item.is_viewed
    });
  }

  return res.json({ storyGroups: Array.from(userMap.values()) });
});

apiRouter.post('/stories', authMiddleware, (req: AuthRequest, res: Response) => {
  const { image_url, caption } = req.body;
  if (!image_url) return res.status(400).json({ error: 'Image required for story' });

  const storyId = 'sty_' + crypto.randomUUID().slice(0, 8);
  db.prepare(`
    INSERT INTO stories (id, user_id, image_url, caption, expires_at)
    VALUES (?, ?, ?, ?, datetime('now', '+24 hours'))
  `).run(storyId, req.user!.id, image_url, caption || '');

  eventManager.broadcast('new_story', {
    userId: req.user!.id,
    storyId
  });

  return res.status(201).json({ id: storyId, success: true });
});

apiRouter.post('/stories/:id/view', authMiddleware, (req: AuthRequest, res: Response) => {
  const viewId = 'sv_' + crypto.randomUUID().slice(0, 8);
  try {
    db.prepare('INSERT OR IGNORE INTO story_views (id, story_id, user_id) VALUES (?, ?, ?)').run(viewId, req.params.id, req.user!.id);
  } catch (e) {}
  return res.json({ viewed: true });
});

apiRouter.delete('/stories/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  const story = db.prepare('SELECT user_id FROM stories WHERE id = ?').get(req.params.id) as any;
  if (!story) return res.status(404).json({ error: 'Story not found' });
  if (story.user_id !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });

  db.prepare('DELETE FROM stories WHERE id = ?').run(req.params.id);
  return res.json({ success: true });
});

// ======================== MESSAGING ========================

apiRouter.get('/conversations', authMiddleware, (req: AuthRequest, res: Response) => {
  const currentUserId = req.user!.id;

  // Find all conversations where current user is a member
  const convs = db.prepare(`
    SELECT c.id, c.updated_at,
           other_u.id as other_id, other_u.username, other_u.display_name, other_u.avatar_url, other_u.is_verified,
           (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_content,
           (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_time,
           (SELECT sender_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_sender,
           (SELECT COUNT(m2.id) FROM messages m2 WHERE m2.conversation_id = c.id AND m2.sender_id != ? AND datetime(m2.created_at) > datetime(cm.last_read_at)) as unread_count
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
    JOIN conversation_members other_cm ON other_cm.conversation_id = c.id AND other_cm.user_id != ?
    JOIN users other_u ON other_u.id = other_cm.user_id
    ORDER BY c.updated_at DESC
  `).all(currentUserId, currentUserId, currentUserId);

  return res.json({ conversations: convs });
});

apiRouter.post('/conversations', authMiddleware, (req: AuthRequest, res: Response) => {
  const participant_id = req.body.participant_id || req.body.recipient_id;
  const currentUserId = req.user!.id;

  if (!participant_id || participant_id === currentUserId) {
    return res.status(400).json({ error: 'Invalid participant' });
  }

  // Check if conversation already exists between both users
  const existing = db.prepare(`
    SELECT c.id
    FROM conversations c
    JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
    JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
  `).get(currentUserId, participant_id) as any;

  if (existing) {
    return res.json({ conversationId: existing.id });
  }

  const convId = 'conv_' + crypto.randomUUID().slice(0, 8);
  db.prepare('INSERT INTO conversations (id) VALUES (?)').run(convId);
  db.prepare('INSERT INTO conversation_members (id, conversation_id, user_id) VALUES (?, ?, ?)').run('cm_' + crypto.randomUUID().slice(0, 8), convId, currentUserId);
  db.prepare('INSERT INTO conversation_members (id, conversation_id, user_id) VALUES (?, ?, ?)').run('cm_' + crypto.randomUUID().slice(0, 8), convId, participant_id);

  return res.status(201).json({ conversationId: convId });
});

apiRouter.get('/conversations/:id/messages', authMiddleware, (req: AuthRequest, res: Response) => {
  const convId = req.params.id;
  const currentUserId = req.user!.id;

  // Check membership
  const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(convId, currentUserId);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  // Mark as read
  db.prepare('UPDATE conversation_members SET last_read_at = CURRENT_TIMESTAMP WHERE conversation_id = ? AND user_id = ?').run(convId, currentUserId);

  const messages = db.prepare(`
    SELECT m.*, u.username, u.display_name, u.avatar_url
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ?
    ORDER BY m.created_at ASC
  `).all(convId);

  const otherUser = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_verified, u.bio
    FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ? AND cm.user_id != ?
  `).get(convId, currentUserId);

  return res.json({ messages, otherUser });
});

apiRouter.post('/conversations/:id/messages', authMiddleware, (req: AuthRequest, res: Response) => {
  const convId = req.params.id;
  const currentUserId = req.user!.id;
  const { content, image_url } = req.body;

  if (!content && !image_url) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  // Check membership
  const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(convId, currentUserId);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const msgId = 'msg_' + crypto.randomUUID().slice(0, 8);
  db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_id, content, image_url)
    VALUES (?, ?, ?, ?, ?)
  `).run(msgId, convId, currentUserId, content || '', image_url || null);

  db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(convId);
  db.prepare('UPDATE conversation_members SET last_read_at = CURRENT_TIMESTAMP WHERE conversation_id = ? AND user_id = ?').run(convId, currentUserId);

  const createdMessage = db.prepare(`
    SELECT m.*, u.username, u.display_name, u.avatar_url
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.id = ?
  `).get(msgId) as any;

  // Notify other members
  const otherMembers = db.prepare(`
    SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?
  `).all(convId, currentUserId) as any[];

  for (const om of otherMembers) {
    eventManager.sendToUser(om.user_id, 'new_message', {
      conversationId: convId,
      message: createdMessage
    });
  }

  return res.status(201).json({ message: createdMessage });
});

// ======================== NOTIFICATIONS ========================

apiRouter.get('/notifications', authMiddleware, (req: AuthRequest, res: Response) => {
  const notifs = db.prepare(`
    SELECT n.*,
           u.username as actor_username, u.display_name as actor_display_name, u.avatar_url as actor_avatar_url, u.is_verified as actor_verified
    FROM notifications n
    JOIN users u ON u.id = n.actor_id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC
    LIMIT 40
  `).all(req.user!.id);

  return res.json({ notifications: notifs });
});

apiRouter.post('/notifications/read', authMiddleware, (req: AuthRequest, res: Response) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user!.id);
  return res.json({ success: true });
});

apiRouter.post('/notifications/:id/read', authMiddleware, (req: AuthRequest, res: Response) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  return res.json({ success: true });
});

// ======================== REPORTS & MODERATION ========================

apiRouter.post('/reports', authMiddleware, (req: AuthRequest, res: Response) => {
  const { target_type, target_id, reason, details } = req.body;
  if (!target_type || !target_id || !reason) {
    return res.status(400).json({ error: 'Missing required report fields' });
  }

  const reportId = 'rep_' + crypto.randomUUID().slice(0, 8);
  db.prepare(`
    INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(reportId, req.user!.id, target_type, target_id, reason, details || '');

  return res.status(201).json({ success: true, message: 'Report submitted for review.' });
});

// ======================== ANDROID NATIVE PROJECT DOWNLOAD ========================

apiRouter.get('/android/download-project', async (_req: Request, res: Response) => {
  const androidDir = path.resolve(process.cwd(), 'android');
  if (!fs.existsSync(androidDir)) {
    return res.status(404).json({ error: 'Android native project has not been initialized.' });
  }

  res.attachment('sync-native-android-project.zip');
  res.setHeader('Content-Type', 'application/zip');

  const archive = new (ZipArchive as any)({
    zlib: { level: 9 },
  });

  archive.on('error', (err: any) => {
    console.error('Error packaging Android project:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to compress Android project' });
    }
  });

  archive.pipe(res);

  // Add the entire android directory
  archive.directory(androidDir, 'sync-android');

  // Add root configs for reference
  const capConfig = path.resolve(process.cwd(), 'capacitor.config.json');
  if (fs.existsSync(capConfig)) {
    archive.file(capConfig, { name: 'sync-android/capacitor.config.json' });
  }

  const pkgJson = path.resolve(process.cwd(), 'package.json');
  if (fs.existsSync(pkgJson)) {
    archive.file(pkgJson, { name: 'sync-android/package.json' });
  }

  const workflow = path.resolve(process.cwd(), '.github', 'workflows', 'build-apk.yml');
  if (fs.existsSync(workflow)) {
    archive.file(workflow, { name: 'sync-android/.github/workflows/build-apk.yml' });
  }

  const guide = `# SYNC Mobile - Standalone Native Android Project

This is the complete, official native Android project for SYNC (network.sync.app), built with Android Gradle Plugin 8.x, AndroidX, and Native Capacitor Bridge.

## How to Build the APK in 2 Minutes

### Method 1: Android Studio (GUI - Recommended)
1. Open Android Studio.
2. Select **Open** and choose this \`sync-android\` folder.
3. Allow Gradle to sync dependencies automatically.
4. From the top navigation menu, click:
   **Build > Build Bundle(s) / APK(s) > Build APK(s)**
5. Once built, Android Studio will show a notification popup: click **"locate"** to find your \`app-debug.apk\`.
6. Transfer this \`app-debug.apk\` to your phone or drag and drop onto an emulator to install!

### Method 2: Command Line (One-Liner)
If you have Java JDK and Android SDK installed:
\`\`\`bash
chmod +x ./gradlew
./gradlew assembleDebug
\`\`\`
The compiled APK will immediately be located at:
\`app/build/outputs/apk/debug/app-debug.apk\`

### Method 3: Cloud Automated Build (Zero Setup on your PC)
Push this repository to GitHub! The pre-configured \`.github/workflows/build-apk.yml\` automatically compiles the APK on push/release and uploads \`sync-debug-apk\` for 1-click download from GitHub Actions.
`;

  archive.append(guide, { name: 'sync-android/HOW_TO_BUILD_APK.md' });

  await archive.finalize();
});

