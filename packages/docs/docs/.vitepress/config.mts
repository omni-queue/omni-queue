import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Vasto',
  description: 'TypeScript-first queue runtime documentation',
  base: '/vasto/',
  ignoreDeadLinks: true,
  themeConfig: {
    siteTitle: 'Vasto Docs',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API Reference', link: '/api/' },
      { text: 'Operations', link: '/operations/' },
      { text: 'Migration', link: '/migration/' },
      { text: 'GitHub', link: 'https://github.com/vastohq/vasto' }
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Core Concepts', link: '/guide/core-concepts' },
            { text: 'Workers and Isolation', link: '/guide/workers-and-isolation' },
            { text: 'Storage Backends', link: '/guide/storage-backends' },
            { text: 'Plugins and Lifecycle', link: '/guide/plugins-and-lifecycle' },
            { text: 'Dashboard and Monitoring', link: '/guide/dashboard-and-monitoring' }
          ]
        }
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Overview', link: '/api/' },
            { text: 'Core Runtime', link: '/api/core-runtime' },
            { text: 'Storage Adapters', link: '/api/storage-adapters' },
            { text: 'CLI Reference', link: '/api/cli-reference' }
          ]
        }
      ],
      '/operations/': [
        {
          text: 'Operations',
          items: [
            { text: 'Operations Overview', link: '/operations/' }
          ]
        }
      ],
      '/migration/': [
        {
          text: 'Migration',
          items: [
            { text: 'Migration Overview', link: '/migration/' }
          ]
        }
      ]
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/vastohq/vasto' }
    ],
    search: {
      provider: 'local'
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright 2026 Vasto contributors'
    }
  }
});
