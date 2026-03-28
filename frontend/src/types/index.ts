export type AgentStatus = 'Idle' | 'Running' | 'Success' | 'Failed';

export interface SystemState {
  status: AgentStatus;
  currentAgent: string | null;
  logs: string[];
}

export interface FailedJob {
  title: string;
  company: string;
  url: string;
}

export interface Preferences {
  jobTitle: string;
  location: string;
}

export const agents: { id: string; name: string; desc: string; stub?: boolean }[] = [
  { id: 'LinkedIn Agent', name: 'LinkedIn Auto-Apply', desc: 'Easy Apply for jobs' },
  { id: 'Naukri Agent', name: 'Naukri visibility', desc: 'Profile bounce & refresh' },
  { id: 'Aggregator Agent', name: 'Job Aggregator', desc: 'Scrape leads to JSON [STUB]', stub: true }
];

export const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';
