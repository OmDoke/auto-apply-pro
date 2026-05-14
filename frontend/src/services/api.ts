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
  },

  openChrome: async (): Promise<{ ok: boolean; message: string }> => {
    try {
      const res = await axios.post(`${API_BASE}/open-chrome`);
      return res.data;
    } catch (e: any) {
      return { ok: false, message: e?.response?.data?.message || 'Failed to open Chrome' };
    }
  },

  getChromeStatus: async (): Promise<boolean> => {
    try {
      const res = await axios.get(`${API_BASE}/chrome-status`);
      return res.data.reachable === true;
    } catch {
      return false;
    }
  },

  getProfile: async (): Promise<any> => {
    try {
      const res = await axios.get(`${API_BASE}/profile`);
      return res.data;
    } catch {
      return null;
    }
  },

  updateProfile: async (profile: any): Promise<{ ok: boolean; message: string }> => {
    try {
      const res = await axios.post(`${API_BASE}/profile`, profile);
      return res.data;
    } catch (e: any) {
      return { ok: false, message: e?.response?.data?.message || 'Failed to update profile' };
    }
  },
};
