import { Schema, model } from 'mongoose';

const postSchema = new Schema({ title: { type: String, required: true, trim: true, minlength: 5, maxlength: 180 }, content: { type: String, required: true, trim: true, minlength: 10, maxlength: 12000 }, category: { type: String, required: true, trim: true, maxlength: 100 }, authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, status: { type: String, enum: ['published', 'hidden'], default: 'published', index: true }, tags: { type: [String], default: [] }, upvotes: { type: Number, default: 0, min: 0 }, repliesCount: { type: Number, default: 0, min: 0 }, viewsCount: { type: Number, default: 0, min: 0 }, solvedReplyId: { type: Schema.Types.ObjectId, ref: 'ForumReply', default: null } }, { timestamps: true, versionKey: false });
postSchema.index({ status: 1, createdAt: -1 });
postSchema.index({ title: 'text', content: 'text' });
const replySchema = new Schema({ postId: { type: Schema.Types.ObjectId, ref: 'ForumPost', required: true, index: true }, authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, content: { type: String, required: true, trim: true, minlength: 2, maxlength: 8000 }, status: { type: String, enum: ['published', 'hidden'], default: 'published' }, upvotes: { type: Number, default: 0, min: 0 } }, { timestamps: true, versionKey: false });
replySchema.index({ postId: 1, createdAt: 1 });
const voteSchema = new Schema({ userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, targetType: { type: String, enum: ['post', 'reply'], required: true }, targetId: { type: Schema.Types.ObjectId, required: true } }, { timestamps: true, versionKey: false });
voteSchema.index({ userId: 1, targetType: 1, targetId: 1 }, { unique: true });
const reportSchema = new Schema({ targetType: { type: String, enum: ['post', 'reply'], required: true }, targetId: { type: Schema.Types.ObjectId, required: true }, reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, reason: { type: String, required: true, trim: true, minlength: 5, maxlength: 1000 }, status: { type: String, enum: ['open', 'actioned', 'dismissed'], default: 'open', index: true }, reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' }, reviewedAt: { type: Date }, reviewNote: { type: String, trim: true, maxlength: 1000, default: '' } }, { timestamps: true, versionKey: false });
reportSchema.index({ reporterId: 1, targetType: 1, targetId: 1 });

export const ForumPost = model('ForumPost', postSchema);
export const ForumReply = model('ForumReply', replySchema);
export const ForumVote = model('ForumVote', voteSchema);
export const ForumReport = model('ForumReport', reportSchema);
