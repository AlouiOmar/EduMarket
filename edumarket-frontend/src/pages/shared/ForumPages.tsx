import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { describeApiError } from '../../utils/apiErrors';
import { 
  MessageSquare, 
  ThumbsUp, 
  CheckCircle2, 
  Flag, 
  Search, 
  Plus, 
  Share2, 
  ArrowLeft,
  Sparkles
} from 'lucide-react';
import { forumService } from '../../services/forumService';
import { ForumPost, ForumReply } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/atoms/Button';
import { Avatar } from '../../components/atoms/Avatar';
import { Badge } from '../../components/atoms/Badge';
import { SearchField } from '../../components/molecules/SearchField';
import { FormField } from '../../components/molecules/FormField';
import { Input } from '../../components/atoms/Input';
import { Textarea } from '../../components/atoms/Textarea';
import { Select } from '../../components/atoms/Select';
import { usesApi } from '../../services/apiClient';

/** Stored forum category values stay French for compatibility; only their labels are translated. */
const FORUM_CATEGORIES: Record<string, string> = { 'Développement Web & Cloud': 'web', 'Intelligence Artificielle & Data': 'ai', 'Cybersécurité & Réseaux': 'security' };
const forumCategoryOptions = (t: TFunction) => Object.entries(FORUM_CATEGORIES).map(([value, key]) => ({ value, label: t(`forumUi.categories.${key}`) }));
const forumCategoryLabel = (t: TFunction, value: string) => FORUM_CATEGORIES[value] ? t(`forumUi.categories.${FORUM_CATEGORIES[value]}`) : value;

export const ForumListPage: React.FC = () => {
  const { t } = useTranslation();
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState('');

  // New post state
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('Développement Web & Cloud');
  const [newContent, setNewContent] = useState('');

  useEffect(() => {
    forumService.getPosts({ category, search }).then(res => setPosts(res.data)).catch(() => setError(t('forumUi.loadError')));
  }, [category, search]);

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    try {
    const res = await forumService.addPost({
      title: newTitle.trim(),
      category: newCategory,
      content: newContent.trim(),
    });
    setPosts(prev => [res.data, ...prev]);
    setShowCreateModal(false);
    setNewTitle('');
    setNewContent('');
    setError('');
    } catch (cause) { setError(usesApi ? describeApiError(cause) : t('forumUi.loginToPost')); }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t('forum.communityForum')}</h1>
          <p className="text-xs text-slate-500 mt-1">{t('forumUi.subtitle')}</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)} leftIcon={<Plus className="w-4 h-4" />}>
          {t('forum.askDiscussion')}
        </Button>
      </div>

      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="w-full sm:max-w-md">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t('forum.searchForum')}
          />
        </div>

        <div className="w-full sm:w-60">
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={[{ value: 'all', label: t('forumUi.allCategories') }, ...forumCategoryOptions(t)]}
          />
        </div>
      </div>

      {/* Discussion List */}
      <div className="space-y-3">
        {posts.map(post => (
          <div key={post.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs hover:border-indigo-300 transition-colors flex items-start justify-between gap-6">
            <div className="space-y-2 flex-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-indigo-600">{forumCategoryLabel(t, post.category)}</span>
                <span className="text-slate-300">·</span>
                <span className="text-slate-400">{t('forumUi.by', { name: post.authorName, role: t(`common.roles.${post.authorRole}`, { defaultValue: post.authorRole }) })}</span>
                {post.isSolved && (
                  <Badge variant="success" size="sm">
                    {t('forumUi.solved')}
                  </Badge>
                )}
              </div>

              <Link to={`/forum/${post.id}`} className="block">
                <h3 className="text-sm font-bold text-slate-900 hover:text-indigo-600 transition-colors leading-snug">
                  {post.title}
                </h3>
              </Link>

              <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                {post.content}
              </p>

              <div className="flex items-center gap-4 text-xs text-slate-400 pt-1">
                <span className="tabular-nums">{post.repliesCount} {t('forum.replies')}</span>
                <span className="tabular-nums">{post.viewsCount} {t('forum.views')}</span>
                <span className="tabular-nums">{post.upvotes} {t('forum.upvotes')}</span>
              </div>
            </div>

            <Link to={`/forum/${post.id}`} className="shrink-0 pt-2">
              <Button variant="outline" size="sm">
                {t('forumUi.participate')}
              </Button>
            </Link>
          </div>
        ))}
      </div>

      {/* Create Discussion Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <form onSubmit={handleCreatePost} className="bg-white rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-xl">
            <h2 className="text-base font-bold text-slate-900">{t('forum.askDiscussion')}</h2>
            
            <FormField label={t('forumUi.titleLabel')} required>
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} required placeholder={t('forumUi.titlePlaceholder')} />
            </FormField>

            <FormField label={t('forumUi.category')} required>
              <Select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                options={forumCategoryOptions(t)}
              />
            </FormField>

            <FormField label={t('forumUi.contentLabel')} required>
              <Textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} rows={4} required placeholder={t('forumUi.contentPlaceholder')} />
            </FormField>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" type="button" onClick={() => setShowCreateModal(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" size="sm" type="submit">
                {t('forumUi.publish')}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export const ForumDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const { user } = useAuth();

  const [post, setPost] = useState<ForumPost | null>(null);
  const [replies, setReplies] = useState<ForumReply[]>([]);
  const [replyText, setReplyText] = useState('');
  const [reported, setReported] = useState(false);
  const [reportForm, setReportForm] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (id) {
      forumService.getPostById(id).then(res => setPost(res.data)).catch(() => setError(t('forumUi.notFound')));
      forumService.getReplies(id).then(res => setReplies(res.data)).catch(() => setError(t('forumUi.repliesLoadError')));
    }
  }, [id]);

  if (!post) {
    return <div className="p-8 text-center text-slate-500">{error || t('common.loading')}</div>;
  }

  const handleAddReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    try {
    const res = await forumService.addReply(post.id, replyText.trim(), {
      id: user?.id || 'u1',
      name: user?.name || '',
      avatar: user?.avatar || '',
      role: user?.role || 'student'
    });
    setReplies(prev => [...prev, res.data]);
    setReplyText('');
    setError('');
    } catch (cause) { setError(usesApi ? describeApiError(cause) : t('forumUi.loginToReply')); }
  };

  const handleMarkSolution = async (replyId: string) => {
    try { await forumService.markSolution(post.id, replyId); }
    catch { setError(t('forumUi.onlyAuthorSolution')); return; }
    setReplies(prev => prev.map(r => ({ ...r, isSolution: r.id === replyId })));
    setPost(prev => prev ? { ...prev, isSolved: true } : null);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link to="/forum" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800">
        <ArrowLeft className="w-4 h-4 rtl-flip" />
        <span>{t('forumUi.backToForum')}</span>
      </Link>

      {/* Main Post Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <Avatar src={post.authorAvatar} alt={post.authorName} size="md" />
            <div>
              <span className="text-xs font-bold text-slate-900 block">{post.authorName}</span>
              <span className="text-[11px] text-slate-400">{t(`common.roles.${post.authorRole}`, { defaultValue: post.authorRole })} · {forumCategoryLabel(t, post.category)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setReportForm(true)}
              className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors text-xs flex items-center gap-1"
            >
              <Flag className="w-3.5 h-3.5" />
              <span>{reported ? t('forumUi.reported') : t('forumUi.report')}</span>
            </button>
          </div>
        </div>

        <h1 className="text-lg font-bold text-slate-900">{post.title}</h1>
        <p className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line">{post.content}</p>

        <div className="flex items-center justify-between pt-4 border-t border-slate-100 text-xs">
          <button
            disabled={usesApi && post.isUpvoted}
            onClick={async () => { try { const result = await forumService.upvote(post.id); setPost(prev => prev ? { ...prev, upvotes: result.data, isUpvoted: true } : null); } catch { setError(t('forumUi.loginToVote')); } }}
            className="flex items-center gap-1.5 text-slate-600 hover:text-indigo-600 font-semibold disabled:opacity-50"
          >
            <ThumbsUp className="w-4 h-4" />
            <span className="tabular-nums">{post.upvotes} {t('forum.upvotes')}</span>
          </button>
          <span className="text-slate-400 tabular-nums">{replies.length} {t('forum.replies')}</span>
        </div>
      </div>

      {/* Replies Thread */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold text-slate-900">{t('forumUi.repliesTitle', { count: replies.length })}</h2>

        {replies.map(rep => (
          <div
            key={rep.id}
            className={`rounded-xl p-6 border shadow-xs space-y-3 ${
              rep.isSolution
                ? 'bg-emerald-50/50 border-emerald-300 ring-1 ring-emerald-200'
                : 'bg-white border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar src={rep.authorAvatar} alt={rep.authorName} size="sm" />
                <div>
                  <span className="text-xs font-bold text-slate-900 block">{rep.authorName}</span>
                  <span className="text-[11px] text-slate-400">{t(`common.roles.${rep.authorRole}`, { defaultValue: rep.authorRole })}</span>
                </div>
              </div>

              {rep.isSolution ? (
                <div className="flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{t('forumUi.bestSolution')}</span>
                </div>
              ) : (!usesApi || user?.id === post.authorId) ? (
                <Button variant="outline" size="sm" onClick={() => handleMarkSolution(rep.id)}>
                  {t('forumUi.markSolution')}
                </Button>
              ) : null}
            </div>

            <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">
              {rep.content}
            </p>
          </div>
        ))}
      </div>

      {/* Reply Box */}
      <form onSubmit={handleAddReply} className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-3">
        <h3 className="text-xs font-bold text-slate-900">{t('forum.replyToDiscussion')}</h3>
        <Textarea
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder={t('forumUi.replyPlaceholder')}
          rows={3}
          required
        />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="sm">
            {t('forumUi.publishReply')}
          </Button>
        </div>
      </form>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {reportForm && <form onSubmit={async event => { event.preventDefault(); try { await forumService.reportPost(post.id, reportReason); setReported(true); setReportForm(false); setError(''); } catch { setError(t('forumUi.loginToReport')); } }} className="bg-white border border-rose-200 rounded-xl p-4 space-y-3">
        <label className="block text-xs font-semibold">{t('forumUi.reportReason')}<textarea required minLength={5} maxLength={1000} value={reportReason} onChange={event => setReportReason(event.target.value)} className="mt-2 w-full rounded border p-2" /></label>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setReportForm(false)}>{t('common.cancel')}</Button><Button type="submit" variant="outline" size="sm">{t('forumUi.sendReport')}</Button></div>
      </form>}
    </div>
  );
};
