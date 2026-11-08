package space.opencalendar.app;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import androidx.appcompat.app.AppCompatDelegate;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // The app supplies its own light palettes; system night mode must not
        // recolor the WebView or native form controls independently of them.
        getDelegate().setLocalNightMode(AppCompatDelegate.MODE_NIGHT_NO);
        super.onCreate(savedInstanceState);
        // Capacitor SystemBars provides matching CSS insets, including a
        // native-padding fallback for older Android WebView versions.
        EdgeToEdge.enable(this);
    }
}
