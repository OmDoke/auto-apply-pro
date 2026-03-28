import axios from 'axios';
import { FailedJob, API_BASE } from '../types';

export const apiService = {
  getFailedJobs: async (): Promise<FailedJob[]> => {
    try {
      const res = await axios.get(`${API_BASE}/failed-jobs`);
      return res.data;
    } catch {
      return [];
    }
  },

  clearFailedJobs: async (): Promise<void> => {
    await axios.delete(`${API_BASE}/failed-jobs`);
  }
};
