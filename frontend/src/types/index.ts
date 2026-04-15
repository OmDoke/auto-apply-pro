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

export interface HiringPost {
  link: string;
  postedAt: string;
  snippet: string;
  fullText?: string;
  authorName?: string;
  authorTitle?: string;
  authorProfileUrl?: string;
  emails?: string[];
  phones?: string[];
  jobTitle?: string;
  company?: string;
  scrapedAt?: string;
}

export interface Preferences {
  jobTitle: string;
  location: string;
}

export const agents: { id: string; name: string; desc: string; stub?: boolean }[] = [
  { id: 'LinkedIn Agent', name: 'LinkedIn Auto-Apply', desc: 'Easy Apply for jobs' },
  { id: 'LinkedIn Post Scraper', name: 'LinkedIn Posts', desc: 'Scrape hiring posts matching your profile' },
  { id: 'Naukri Agent', name: 'Naukri visibility', desc: 'Profile bounce & refresh' },
  { id: 'Indeed Agent', name: 'Indeed Agent', desc: 'Scan and apply to jobs on Indeed using Easy Apply', stub: false },
  { id: 'Glassdoor Agent', name: 'Glassdoor Agent', desc: 'Scan and apply to jobs on Glassdoor (Coming Soon)', stub: true },
  { id: 'Wellfound Agent', name: 'Wellfound Agent', desc: 'Auto-apply to startups on Wellfound (Coming Soon)', stub: true },
  { id: 'Aggregator Agent', name: 'Job Aggregator', desc: 'Scrape leads to JSON [STUB]', stub: true }
];

export const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';
