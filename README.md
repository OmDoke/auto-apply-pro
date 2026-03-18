# Auto-Apply Pro

An agentic job application suite that automates profile updates and job discovery across LinkedIn, Naukri, and Indeed. Built with a React.js control dashboard and a Node.js/Puppeteer automation engine.

## Features
- **Job Automation Engine**: Uses Puppeteer for web scraping and automation on popular job boards.
- **Control Dashboard**: A React-based UI to manage job applications and profile updates.
- **Cross-Platform**: Integrates with LinkedIn, Naukri, and Indeed.

## Tech Stack
- **Frontend**: React, TypeScript, Vite, Tailwind CSS
- **Backend**: Node.js, Express, Puppeteer
- **Tools**: Concurrently (for monorepo management)

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
