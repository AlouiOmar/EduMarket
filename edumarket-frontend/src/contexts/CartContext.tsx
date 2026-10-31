import React, { createContext, useContext, useEffect, useState } from 'react';
import { Course } from '../types';

export interface CartItem {
  id: string;
  course: Course;
}

interface CartContextType {
  items: CartItem[];
  addToCart: (course: Course) => void;
  removeFromCart: (courseId: string) => void;
  clearCart: () => void;
  isInCart: (courseId: string) => boolean;
  totalPrice: number;
}

const CART_STORAGE_KEY = 'edumarket_cart';
const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Persisted so the cart survives the redirect to and from the payment provider. Prices are display-only: the API reprices every order.
  const [items, setItems] = useState<CartItem[]>(() => {
    try { return JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]') as CartItem[]; }
    catch { return []; }
  });

  useEffect(() => {
    try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items)); }
    catch { /* storage unavailable: keep the in-memory cart */ }
  }, [items]);

  const addToCart = (course: Course) => {
    if (!items.some(i => i.course.id === course.id)) {
      setItems(prev => [...prev, { id: `item_${course.id}`, course }]);
    }
  };

  const removeFromCart = (courseId: string) => {
    setItems(prev => prev.filter(i => i.course.id !== courseId));
  };

  const clearCart = () => {
    setItems([]);
  };

  const isInCart = (courseId: string) => {
    return items.some(i => i.course.id === courseId);
  };

  const totalPrice = items.reduce((acc, curr) => {
    const price = curr.course.discountPrice !== undefined ? curr.course.discountPrice : curr.course.price;
    return acc + price;
  }, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        addToCart,
        removeFromCart,
        clearCart,
        isInCart,
        totalPrice,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};
