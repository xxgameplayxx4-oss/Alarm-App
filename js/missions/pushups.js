import { makeCameraMission } from './camera-mission.js';

export default makeCameraMission({
  id: 'pushups', name: 'Push-ups', icon: '💪', exercise: 'pushup',
  defaultCount: 10, maxCount: 100,
  hint: 'Prop phone on the floor ~1 m in front of you, facing you',
});
