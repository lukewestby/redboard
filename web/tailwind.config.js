module.exports = {
  purge: [],
  darkMode: false, // or 'media' or 'class'
  theme: {
    fontFamily: {
      inter: ['Inter', 'sans-serif'],
      archivo: ['Archivo', 'sans-serif'],
      times: ['Times New Roman', 'serif'],
    },
    extend: {
      borderWidth: {
        '3': '3px'
      },
      spacing: {
        '108': '27rem'
      },
      scale: {
        '200': '2',
      }
    }
  },
  variants: {
    extend: {},
  },
  plugins: [],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ]
}
