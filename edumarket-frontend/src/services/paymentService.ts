import { mockTransactions, mockSubscriptionPlans } from '../mocks/mockData';
import { Transaction, SubscriptionPlan } from '../types';
import { apiRequest, delay, createSuccessResponse, ApiResponse, usesApi } from './apiClient';

class PaymentService {
  private transactions: Transaction[] = [...mockTransactions];
  private plans: SubscriptionPlan[] = [...mockSubscriptionPlans];

  async getTransactions(userId?: string): Promise<ApiResponse<Transaction[]>> {
    await delay();
    if (!userId) return createSuccessResponse(this.transactions);
    return createSuccessResponse(this.transactions.filter(t => t.userId === userId));
  }

  async getSubscriptionPlans(): Promise<ApiResponse<SubscriptionPlan[]>> {
    await delay(50);
    return createSuccessResponse(this.plans);
  }

  async processCheckout(payload: {
    items: { id: string; title: string; price: number }[];
    paymentMethod: string;
    userId: string;
    userName: string;
  }): Promise<ApiResponse<{ transactionId: string }>> {
    if (usesApi) {
      // Only product identifiers are sent; the server owns pricing and payment state.
      return apiRequest<ApiResponse<{ transactionId: string }>>('/payments/checkout', {
        method: 'POST', body: JSON.stringify({
          courseIds: payload.items.map(item => item.id),
          paymentMethod: payload.paymentMethod.includes('PayPal') ? 'paypal' : payload.paymentMethod.includes('Virement') ? 'transfer' : 'card',
        }),
      });
    }
    await delay(400); // simulate payment network roundtrip
    const total = payload.items.reduce((sum, item) => sum + item.price, 0);
    const txId = `tx_${Date.now()}`;
    const newTx: Transaction = {
      id: txId,
      date: new Date().toISOString().split('T')[0],
      amount: total,
      currency: 'EUR',
      status: 'succeeded',
      type: 'course_purchase',
      itemName: payload.items.map(i => i.title).join(', '),
      sellerCommission: Math.round(total * 0.8 * 100) / 100,
      platformFee: Math.round(total * 0.2 * 100) / 100,
      paymentMethod: payload.paymentMethod,
      invoiceUrl: '#',
      userId: payload.userId,
      userName: payload.userName
    };
    this.transactions.unshift(newTx);
    return createSuccessResponse({ transactionId: txId }, 'Paiement simulé avec succès');
  }

  async refundTransaction(id: string): Promise<ApiResponse<boolean>> {
    await delay();
    const tx = this.transactions.find(t => t.id === id);
    if (!tx) return createSuccessResponse(false, 'Transaction introuvable');
    tx.status = 'refunded';
    return createSuccessResponse(true, 'Transaction remboursée');
  }
}

export const paymentService = new PaymentService();
