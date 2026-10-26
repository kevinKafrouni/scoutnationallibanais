// Public content only. Never place credentials in this file.
export const siteConfig = {
  organizationName: 'Scout National Libanais',
  hero: {
    title: ['Adventure.', 'Brotherhood.', 'Service.'],
    subtitle: 'Building responsible, capable and engaged young people through scouting.',
    image: '/hero-mountains.jpg',
    imageAlt: 'Mountain peaks beneath a wide open sky',
  },
  contact: { email: '', phone: '', location: '' },
  social: { instagram: '', facebook: '' },
  // TODO: configure a real contact endpoint after implementing server-side
  // validation, delivery, rate limiting and abuse protection.
  contactEndpoint: '',
  values: [
    { name: 'Adventure', icon: 'mountain', description: 'Explore, challenge yourself and discover new experiences.' },
    { name: 'Brotherhood', icon: 'people', description: 'Build friendships, teamwork and a strong sense of belonging.' },
    { name: 'Service', icon: 'heart', description: 'Make a positive difference in the community.' },
    { name: 'Leadership', icon: 'compass', description: 'Develop responsibility, confidence and practical leadership skills.' },
  ],
  branches: [
    { name: 'Cubs', ages: 'Ages 7-11', icon: 'leaf', description: 'Learn through games, discovery and teamwork.' },
    { name: 'Scouts', ages: 'Ages 12-15', icon: 'mountain', description: 'Adventure, skills, teamwork and personal growth.' },
    { name: 'Rovers', ages: 'Ages 16-18', icon: 'compass', description: 'Service, leadership and challenging experiences.' },
    { name: 'Leaders', ages: 'Ages 18+', icon: 'people', description: 'Guide and support the next generation.' },
  ],
};
