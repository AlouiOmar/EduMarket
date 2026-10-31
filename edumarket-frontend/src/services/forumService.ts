import { mockForumPosts } from '../mocks/mockData';
import { ForumPost, ForumReply } from '../types';
import { delay, createSuccessResponse, ApiResponse, apiRequest, usesApi } from './apiClient';

export interface ForumReportItem { id: string; targetType: 'post' | 'reply'; targetId: string; reporter: { name: string; role: string }; reason: string; createdAt: string; }

class ForumService {
  private posts: ForumPost[] = [...mockForumPosts];
  private replies: Record<string, ForumReply[]> = {
    post_1: [
      {
        id: 'reply_1',
        postId: 'post_1',
        authorId: 'user_teacher_1',
        authorName: 'Dr. Sarah Mansour',
        authorAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
        authorRole: 'Formatrice',
        content: `Pour l'arabe avec RTL :
1. Définissez document.documentElement.dir = "rtl" et lang = "ar".
2. Utilisez les classes CSS logiques (ms-, me-, ps-, pe-) plutôt que ml-/mr-.
3. Pour les icônes de flèches (ChevronRight / ArrowRight), ajoutez une classe conditionnelle [dir="rtl"]:rotate-180.
4. Les numéros de téléphone et dates doivent toujours avoir dir="ltr" pour préserver le sens naturel.`,
        createdAt: '2026-10-10T11:20:00Z',
        upvotes: 19,
        isSolution: true
      }
    ],
    post_2: [
      {
        id: 'reply_2',
        postId: 'post_2',
        authorId: 'user_mod_1',
        authorName: 'Nadia Larbi',
        authorAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
        authorRole: 'Modératrice',
        content: 'Pensez à bien réviser les analyses de logs Apache/Nginx et l’écriture de requêtes KQL sous Kibana !',
        createdAt: '2026-10-11T18:10:00Z',
        upvotes: 8,
        isSolution: false
      }
    ]
  };

  async getPosts(filters?: { category?: string; search?: string }): Promise<ApiResponse<ForumPost[]>> {
    if (usesApi) {
      const params = new URLSearchParams();
      if (filters?.category) params.set('category', filters.category);
      if (filters?.search) params.set('search', filters.search);
      const result = await apiRequest<{ data: ForumPost[]; total: number }>(`/forum/posts?${params}`);
      return createSuccessResponse(result.data, undefined, result.total);
    }
    await delay();
    let res = [...this.posts];
    if (filters?.category && filters.category !== 'all') {
      res = res.filter(p => p.category === filters.category);
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      res = res.filter(p => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q));
    }
    return createSuccessResponse(res);
  }

  async getPostById(id: string): Promise<ApiResponse<ForumPost | null>> {
    if (usesApi) {
      const result = await apiRequest<{ data: ForumPost }>(`/forum/posts/${encodeURIComponent(id)}`);
      return createSuccessResponse(result.data);
    }
    await delay();
    const p = this.posts.find(item => item.id === id) || null;
    return createSuccessResponse(p);
  }

  async getReplies(postId: string): Promise<ApiResponse<ForumReply[]>> {
    if (usesApi) {
      const result = await apiRequest<{ data: ForumReply[] }>(`/forum/posts/${encodeURIComponent(postId)}/replies`);
      return createSuccessResponse(result.data);
    }
    await delay();
    return createSuccessResponse(this.replies[postId] || []);
  }

  async addPost(data: Partial<ForumPost>): Promise<ApiResponse<ForumPost>> {
    if (usesApi) {
      const result = await apiRequest<{ data: ForumPost }>('/forum/posts', { method: 'POST', body: JSON.stringify({ title: data.title, content: data.content, category: data.category, tags: data.tags || [] }) });
      return createSuccessResponse(result.data);
    }
    await delay();
    const post: ForumPost = {
      id: `post_${Date.now()}`,
      title: data.title || '',
      content: data.content || '',
      category: data.category || 'Développement Web & Cloud',
      authorId: data.authorId || 'user_student_1',
      authorName: data.authorName || 'Karim Benali',
      authorAvatar: data.authorAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      authorRole: 'Étudiant',
      createdAt: new Date().toISOString(),
      upvotes: 1,
      repliesCount: 0,
      isSolved: false,
      viewsCount: 1,
      tags: data.tags || ['Général']
    };
    this.posts.unshift(post);
    this.replies[post.id] = [];
    return createSuccessResponse(post, 'Discussion créée avec succès');
  }

  async addReply(postId: string, content: string, user: { id: string; name: string; avatar: string; role: string }): Promise<ApiResponse<ForumReply>> {
    if (usesApi) {
      const result = await apiRequest<{ data: ForumReply }>(`/forum/posts/${encodeURIComponent(postId)}/replies`, { method: 'POST', body: JSON.stringify({ content }) });
      return createSuccessResponse(result.data);
    }
    await delay();
    const reply: ForumReply = {
      id: `reply_${Date.now()}`,
      postId,
      authorId: user.id,
      authorName: user.name,
      authorAvatar: user.avatar,
      authorRole: user.role,
      content,
      createdAt: new Date().toISOString(),
      upvotes: 0,
      isSolution: false
    };
    if (!this.replies[postId]) this.replies[postId] = [];
    this.replies[postId].push(reply);

    const post = this.posts.find(p => p.id === postId);
    if (post) post.repliesCount += 1;

    return createSuccessResponse(reply, 'Réponse publiée');
  }

  async markSolution(postId: string, replyId: string): Promise<ApiResponse<boolean>> {
    if (usesApi) {
      await apiRequest(`/forum/posts/${encodeURIComponent(postId)}/solution/${encodeURIComponent(replyId)}`, { method: 'PATCH' });
      return createSuccessResponse(true);
    }
    await delay();
    const post = this.posts.find(p => p.id === postId);
    if (post) {
      post.isSolved = true;
      post.solvedReplyId = replyId;
    }
    const reps = this.replies[postId] || [];
    reps.forEach(r => {
      r.isSolution = (r.id === replyId);
    });
    return createSuccessResponse(true, 'Marqué comme solution validée');
  }

  async upvote(postId: string): Promise<ApiResponse<number>> {
    if (usesApi) {
      const result = await apiRequest<{ data: { upvotes: number } }>(`/forum/posts/${encodeURIComponent(postId)}/upvote`, { method: 'POST', body: '{}' });
      return createSuccessResponse(result.data.upvotes);
    }
    await delay(50);
    const post = this.posts.find(p => p.id === postId);
    if (post) {
      post.upvotes += 1;
      return createSuccessResponse(post.upvotes);
    }
    return createSuccessResponse(0);
  }

  async reportPost(postId: string, reason: string): Promise<void> {
    if (usesApi) await apiRequest(`/forum/posts/${encodeURIComponent(postId)}/report`, { method: 'POST', body: JSON.stringify({ reason }) });
    else await delay();
  }

  async getReports(): Promise<ForumReportItem[]> {
    const result = await apiRequest<{ data: ForumReportItem[] }>('/forum/reports');
    return result.data;
  }

  async reviewReport(id: string, decision: 'actioned' | 'dismissed'): Promise<void> {
    await apiRequest(`/forum/reports/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ decision }) });
  }
}

export const forumService = new ForumService();
