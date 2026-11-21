# Security Specification & Hardening Audit

## 1. Data Invariants
1. **Identity Integrity**: Every user-owned document (`posts`, `likes`, `comments`, `bookmarks`, `stories`, `blocks`, `reports`, `notifications`, `follow_requests`) requires `request.auth != null && request.auth.token.email_verified == true` and checks that the owner/author/actor UID equals `request.auth.uid`.
2. **PII Isolation**: User email addresses are stored exclusively in `/users/{userId}/private/info`, accessible only when `request.auth.uid == userId`. Public `/users/{userId}` documents contain zero PII.
3. **Immutable Ownership & Creation Timestamps**: `user_id`, `created_at`, and `is_verified` (locked to `false` on user creation) cannot be forged or modified on update.
4. **Temporal Integrity**: `created_at` and `updated_at` must equal `request.time`.
5. **Atomic Counters**: Liking/unliking a post, adding/deleting a comment, or reposting/quoting a post must atomically update the parent post's `likes_count`, `comments_count`, or `reposts_count` using `existsAfter`/`getAfter` or strict `+1/-1` guards.
6. **Master Gate on Messaging**: Messages and read receipts inside `/conversations/{convId}` verify membership on the parent conversation document via `get()` on write and `request.auth.uid in resource.data.member_ids` on list/get.
7. **Sync Points & 2x Ultra Integrity**: Users may only write to `/sync_points/{userId}` when `userId == request.auth.uid`, with monotonic bounded increments (`<= +500` points and `<= +5` interactions per write) and `is_verified` strictly matching `/users/{userId}.is_verified`.
8. **Story Tags & Views Privacy**: Story updates by owners only sync profile snapshots (`username`, `display_name`, `avatar_url`) while preserving immutable `tags`, `image_url`, and `expires_at`; story view records are listable only by the viewer or the parent story author.

## 2. Dirty Dozen Adversarial Payloads (Must All Yield PERMISSION_DENIED)
1. **Self-Verification Privilege Escalation**: `POST /users/{uid}` with `{ is_verified: true }`.
2. **PII Cross-Read**: `GET /users/{otherUid}/private/info` by another signed-in user.
3. **Author Spoofing on Post**: `POST /posts/{id}` with `{ user_id: "victim_uid" }`.
4. **Ghost Field Shadow Update**: `PUT /posts/{id}` adding `{ is_verified: true }` alongside `content`.
5. **Client Timestamp Forgery**: `POST /posts/{id}` with `created_at: "2020-01-01T00:00:00Z"`.
6. **Unpaired Like Counter Manipulation**: `PUT /posts/{id}` incrementing `likes_count` without creating `/likes/{postId}__{uid}` in the same batch.
7. **Orphaned Comment Write**: `POST /comments/{id}` pointing to a non-existent `post_id`.
8. **Unread Notification Tampering / Cross-User Read**: `LIST /notifications` without filtering `user_id == request.auth.uid`.
9. **Unauthorized Message Injection**: `POST /conversations/{convId}/messages/{msgId}` by a user not in `conversations/{convId}.member_ids`.
10. **Oversized ID Poisoning**: `POST /posts/{1500_char_id}` attempting document ID exhaustion.
11. **Unverified Email Write**: Any write operation when `request.auth.token.email_verified == false`.
12. **Terminal Status Tampering on Reports**: Creating a `/reports/{id}` with `status: "resolved"` instead of `"pending"`.
