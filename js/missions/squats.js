import { makeCameraMission } from './camera-mission.js';

export default makeCameraMission({
  id: 'squats', name: 'Squats', icon: '🏋️', exercise: 'squat',
  defaultCount: 15, maxCount: 100,
  hint: 'Stand the phone up ~2 m away so your whole body is visible',
});
