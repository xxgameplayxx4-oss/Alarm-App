package io.github.xxgameplayxx4.pushupalarm;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Calendar;

/** Saved alarms (a JSON array in SharedPreferences) and their AlarmManager schedule. */
final class Alarms {
    static final String EXTRA_ID = "alarm_id";
    static final int TEST_ID = -1;
    private static final String PREFS = "alarms";
    private static final String KEY_LIST = "list";
    private static final String KEY_SCHEDULED = "scheduled";

    private Alarms() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** [{id, h, m, days:[0..6, Sunday = 0], on}]; empty days = rings once. */
    static JSONArray load(Context c) {
        try {
            return new JSONArray(prefs(c).getString(KEY_LIST, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    static void save(Context c, JSONArray list) {
        prefs(c).edit().putString(KEY_LIST, list.toString()).apply();
        scheduleAll(c);
    }

    /** Next time (ms) this alarm should ring after now, or -1 if it is off. */
    static long nextTrigger(JSONObject a, long now) {
        if (!a.optBoolean("on", true)) return -1;
        JSONArray days = a.optJSONArray("days");
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(now);
        cal.set(Calendar.HOUR_OF_DAY, a.optInt("h", 7));
        cal.set(Calendar.MINUTE, a.optInt("m", 0));
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        for (int i = 0; i < 8; i++) {
            if (cal.getTimeInMillis() > now) {
                int dow = cal.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY;
                if (days == null || days.length() == 0 || contains(days, dow)) return cal.getTimeInMillis();
            }
            cal.add(Calendar.DAY_OF_MONTH, 1);
        }
        return -1;
    }

    private static boolean contains(JSONArray arr, int v) {
        for (int i = 0; i < arr.length(); i++) if (arr.optInt(i, -1) == v) return true;
        return false;
    }

    /** Soonest upcoming ring across all alarms, or -1. */
    static long nextAny(Context c) {
        JSONArray list = load(c);
        long now = System.currentTimeMillis(), best = -1;
        for (int i = 0; i < list.length(); i++) {
            JSONObject a = list.optJSONObject(i);
            if (a == null) continue;
            long t = nextTrigger(a, now);
            if (t > 0 && (best < 0 || t < best)) best = t;
        }
        return best;
    }

    private static PendingIntent firePending(Context c, int id) {
        Intent i = new Intent(c, AlarmReceiver.class).putExtra(EXTRA_ID, id);
        return PendingIntent.getBroadcast(c, id, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void scheduleAll(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        SharedPreferences p = prefs(c);
        // Cancel everything we scheduled last time, then schedule the current list.
        try {
            JSONArray old = new JSONArray(p.getString(KEY_SCHEDULED, "[]"));
            for (int i = 0; i < old.length(); i++) am.cancel(firePending(c, old.optInt(i)));
        } catch (JSONException ignored) { }

        JSONArray list = load(c);
        JSONArray scheduled = new JSONArray();
        long now = System.currentTimeMillis();
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent show = PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_IMMUTABLE);
        for (int i = 0; i < list.length(); i++) {
            JSONObject a = list.optJSONObject(i);
            if (a == null) continue;
            long t = nextTrigger(a, now);
            if (t < 0) continue;
            int id = a.optInt("id");
            try {
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(t, show), firePending(c, id));
                scheduled.put(id);
            } catch (SecurityException e) {
                // Exact alarms not allowed; fall back to an inexact one so it still rings.
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, firePending(c, id));
                scheduled.put(id);
            }
        }
        p.edit().putString(KEY_SCHEDULED, scheduled.toString()).apply();
    }

    static void scheduleTest(Context c, long inMs) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        long t = System.currentTimeMillis() + inMs;
        PendingIntent show = PendingIntent.getActivity(c, 0,
                new Intent(c, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        try {
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(t, show), firePending(c, TEST_ID));
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, firePending(c, TEST_ID));
        }
    }

    /** Called when alarm {@code id} fires: one-time alarms switch off, then everything is rescheduled. */
    static void onFired(Context c, int id) {
        if (id == TEST_ID) return;
        JSONArray list = load(c);
        for (int i = 0; i < list.length(); i++) {
            JSONObject a = list.optJSONObject(i);
            if (a == null || a.optInt("id") != id) continue;
            JSONArray days = a.optJSONArray("days");
            if (days == null || days.length() == 0) {
                try { a.put("on", false); } catch (JSONException ignored) { }
            }
        }
        save(c, list);
    }
}
