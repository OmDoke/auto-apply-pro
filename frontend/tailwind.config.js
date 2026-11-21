import colors from 'tailwindcss/colors'

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Neutral greys everywhere: `slate` has a blue tint, `zinc` reads as clean grey
        slate: colors.zinc,
      },
    },
  },
  plugins: [],
}
