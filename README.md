# Auto-Apply Pro

An agentic job application suite that automates profile updates and job discovery across LinkedIn, Naukri, and Indeed. Built with a React.js control dashboard and a Node.js/Puppeteer automation engine.


## Key Concepts

| Concept | Description |
|---------|-------------|
| **Browser Automation** | Puppeteer controls a real Chromium browser to navigate job portals, fill forms, and click buttons exactly as a human would — no fragile API hacks. |
| **AI-Powered Q&A** | A 3-tier answer engine resolves job application questions: rule-based patterns first, fuzzy-string matching second, and a Groq LLM (LLaMA 3) as a last resort — all seeded from your resume. |
| **Sequential Agent Pipeline** | LinkedIn and Naukri agents run one after the other in child processes managed by a central controller. Each agent is isolated — a crash in one does not affect the other. |
| **Real-Time Dashboard** | Socket.IO streams live logs and agent status from the backend to the React UI. No polling; updates appear instantly as actions happen. |
| **Graceful Process Management** | The controller tracks all active child processes in an array. Clicking Stop kills every running process cleanly, preventing orphaned browser windows. |
| **Resume-Aware Answers** | Your PDF resume is parsed once and cached. The Groq LLM uses it as context to answer dynamic form questions such as years of experience or skills. |

---

## Tech Stack

### Backend
| Tool | Role |
|------|------|
| **Node.js + Express** | HTTP API server and process orchestrator |
| **Puppeteer** | Headless Chromium automation for LinkedIn & Naukri |
| **Socket.IO** | Real-time bidirectional log streaming to the frontend |
| **LangChain + Groq (LLaMA 3)** | LLM inference for answering unknown job form questions |
| **pdf-parse** | Extracts text from the user's resume PDF |
| **string-similarity** | Fuzzy matching of question text against known answer keys |
| **dotenv** | Environment variable management |

### Frontend
| Tool | Role |
|------|------|
| **React + TypeScript** | Component-based control dashboard |
| **Vite** | Fast dev server and production bundler |
| **Tailwind CSS** | Utility-first styling |
| **Socket.IO Client** | Live log and status updates from the backend |

---

## How It Works

```
User sets Job Title + Location in the Dashboard
              │
              ▼
   Frontend sends preferences via Socket.IO
              │
              ▼
  sequentialController.js forks child processes
       ┌──────────────────────────┐
       │  1. linkedinAgent.js     │  → Search → Easy Apply → Resume select → Form fill (AI Q&A) → Submit
       │  2. naukriAgent.js       │  → Search → Apply → Confirm success → Chatbot Q&A (iterative)
       └──────────────────────────┘
              │  stdout piped back as logs
              ▼
       Socket.IO broadcasts logs in real time
              │
              ▼
   Dashboard shows live status + log feed
              │
              ▼
   Failed jobs saved to backend/data/failed_jobs.json
   for manual review in the dashboard
```

**Answer Resolution Flow (per form question):**
```
Question text
    │
    ├─ 1. Rule-based match  → keywords like "notice period", "github", "salary" → instant answer
    │
    ├─ 2. Fuzzy match       → string-similarity against answers.json keys → answer if score ≥ 0.5
    │
    └─ 3. AI fallback       → Groq LLaMA 3 reads resume PDF + question → generates answer
                              (retries 3× with exponential back-off on rate limits)
```

---
## Getting Started

### Prerequisites
- Node.js (v18 or higher recommended)
- npm

### Installation

1. Clone the repository
2. Install dependencies for root, frontend, and backend:
   ```bash
   npm run install:all
   ```

### Running the Application

To start both the frontend and backend servers simultaneously:
```bash
npm run dev
```

The frontend will start using Vite, and the backend Node.js server will launch handling Puppeteer automation requests.
