package pe.edu.pucp.uniteair.dp1backend.websocket;

import org.springframework.util.MultiValueMap;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;

final class WebSocketParamUtils {

    private WebSocketParamUtils() {
    }

    static String queryParam(URI uri, String key) {
        if (uri == null || key == null || key.isBlank()) {
            return null;
        }
        MultiValueMap<String, String> params = UriComponentsBuilder.fromUri(uri).build().getQueryParams();
        String value = params.getFirst(key);
        return value != null && !value.isBlank() ? value : null;
    }
}
