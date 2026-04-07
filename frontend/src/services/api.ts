import axios from 'axios';
import { FailedJob, HiringPost, API_BASE } from '../types';

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
  },

  getHiringPosts: async (): Promise<HiringPost[]> => {
    try {
      const res = await axios.get(`${API_BASE}/hiring-posts`);
      return res.data;
    } catch {
      return [];
    }
  },

  clearHiringPosts: async (): Promise<void> => {
    await axios.delete(`${API_BASE}/hiring-posts`);
  }
};
