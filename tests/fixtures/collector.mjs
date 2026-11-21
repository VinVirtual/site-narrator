// A collector module: gather lines from anywhere and export them (or a function that returns them).
const CHAPTERS = [{ title: 'Start', recap: ['Recap one.', 'Recap two.'] }];
export default async () => CHAPTERS.flatMap((chapter) => [chapter.title, ...chapter.recap]);
