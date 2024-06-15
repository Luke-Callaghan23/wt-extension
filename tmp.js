const glob = require('glob');

let pth;
pth = 'c:/Users/lcallagh/Desktop/vs-code/git/envs/testing/wordWatcher_gatherOverusedWords/fotbb/data/**/*.wt';
// pth = 'C:/Users/lcallagh/Desktop/vs-code/git/envs/testing/wordWatcher_gatherOverusedWords/fotbb/data/chapters/chapter-1678209856463-1f55ce0a-6472-4a95-9393-478fe45aa230/*.wt';
// pth = 'C:/Users/lcallagh/Desktop/vs-code/git/envs/testing/wordWatcher_gatherOverusedWords/fotbb/data/chapters/chapter-1678209856463-1f55ce0a-6472-4a95-9393-478fe45aa230/*.wt'
glob.glob(pth).then(console.log)