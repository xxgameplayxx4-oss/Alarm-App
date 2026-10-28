package io.github.xxgameplayxx4.pushupalarm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Rings until the missions are done. The page asks for QUIET while its own siren plays
 * (and the phone must be still for shake/steps), and the activity asks for LOUD again
 * whenever you leave the app, so switching away never silences the alarm.
 */
public class AlarmService extends Service {
    static final String ACTION_RING = "ring";
    static final String ACTION_QUIET = "quiet";
    static final String ACTION_LOUD = "loud";
    static final String ACTION_STOP = "stop";

    private static final String CHANNEL = "alarm";
    private static final int NOTIF_ID = 1;
    private static final long MAX_RING_MS = 60 * 60 * 1000L;

    private static volatile boolean ringing;

    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private int savedAlarmVol = -1, savedMusicVol = -1;

    static boolean isRinging() { return ringing; }

    static void send(Context c, String action) {
        if (!ringing && !ACTION_RING.equals(action)) return;
        try {
            c.startService(new Intent(c, AlarmService.class).setAction(action));
        } catch (IllegalStateException ignored) {
            // App is in the background and the service is gone; nothing to change.
        }
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null && intent.getAction() != null ? intent.getAction() : ACTION_RING;
        switch (action) {
            case ACTION_QUIET: setLoud(false); break;
            case ACTION_LOUD: setLoud(true); break;
            case ACTION_STOP: stopRinging(); break;
            default: startRinging(); break;
        }
        return START_NOT_STICKY;
    }

    private void startRinging() {
        ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(),
                Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0);
        if (ringing && player != null) { setLoud(true); return; }
        ringing = true;

        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pushupalarm:ring");
        wakeLock.acquire(MAX_RING_MS);

        AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
        savedAlarmVol = am.getStreamVolume(AudioManager.STREAM_ALARM);
        savedMusicVol = am.getStreamVolume(AudioManager.STREAM_MUSIC);
        am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
        // The page's siren plays on the media stream.
        am.setStreamVolume(AudioManager.STREAM_MUSIC, am.getStreamMaxVolume(AudioManager.STREAM_MUSIC), 0);

        player = new MediaPlayer();
        try {
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            player.setDataSource(this, alarmTone());
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception e) {
            player.release();
            player = null;
        }

        vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        vibrate(true);
        handler.postDelayed(this::stopRinging, MAX_RING_MS);
        MainActivity.launchForAlarm(this);
    }

    private Uri alarmTone() {
        Uri uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM);
        if (uri == null) uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_RINGTONE);
        if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        return uri;
    }

    private void vibrate(boolean on) {
        if (vibrator == null) return;
        if (on) vibrator.vibrate(VibrationEffect.createWaveform(new long[]{0, 800, 400}, 0));
        else vibrator.cancel();
    }

    private void setLoud(boolean loud) {
        if (!ringing) return;
        if (player != null) {
            float v = loud ? 1f : 0f;
            player.setVolume(v, v);
        }
        vibrate(loud);
    }

    private void stopRinging() {
        ringing = false;
        handler.removeCallbacksAndMessages(null);
        if (player != null) {
            try { player.stop(); } catch (IllegalStateException ignored) { }
            player.release();
            player = null;
        }
        vibrate(false);
        AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
        if (savedAlarmVol >= 0) am.setStreamVolume(AudioManager.STREAM_ALARM, savedAlarmVol, 0);
        if (savedMusicVol >= 0) am.setStreamVolume(AudioManager.STREAM_MUSIC, savedMusicVol, 0);
        savedAlarmVol = savedMusicVol = -1;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (ringing) stopRinging();
        super.onDestroy();
    }

    private Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Alarm", NotificationManager.IMPORTANCE_HIGH);
        ch.setSound(null, null); // this service plays the sound itself
        ch.enableVibration(false);
        ch.setBypassDnd(true);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);

        PendingIntent open = PendingIntent.getActivity(this, 1, MainActivity.alarmIntent(this),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle("Wake up!")
                .setContentText("Finish your missions to stop the alarm")
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setContentIntent(open)
                .setFullScreenIntent(open, true)
                .build();
    }
}
