import { toast } from 'sonner';

/** The few toasts the app shows. Text arrives already translated. */
export const notify = {
  success: (message: string, description?: string): void => void toast.success(message, { description }),
  info: (message: string, description?: string): void => void toast(message, { description }),
  error: (message: string, description?: string): void => void toast.error(message, { description }),
};
