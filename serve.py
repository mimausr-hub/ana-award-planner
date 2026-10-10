#!/usr/bin/env python3
"""ANA特典航空券プランナー ローカルサーバー（静的配信 + seats.aero API プロキシ）

使い方:
  export SEATS_AERO_KEY=xxxxxxxx      # seats.aero Pro の API キー（設定 → API タブ）
  python3 serve.py                     # http://127.0.0.1:8765/

  キーは環境変数 SEATS_AERO_KEY か、同じフォルダの .seats_aero_key ファイル（1行）から読む。
  ブラウザにはキーを渡さず、このプロセスがヘッダーを付けて seats.aero に中継する。

  SEATS_AERO_MOCK=1 python3 serve.py   # キー無しで画面を試すためのダミー応答
"""
import json, os, sys, urllib.request, urllib.parse, datetime, random
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

PORT = int(os.environ.get('PORT', '8765'))
ROOT = os.path.dirname(os.path.abspath(__file__))
API = 'https://seats.aero/partnerapi/search'

def load_key():
    k = os.environ.get('SEATS_AERO_KEY', '').strip()
    if k:
        return k
    p = os.path.join(ROOT, '.seats_aero_key')
    if os.path.exists(p):
        return open(p).read().strip()
    return ''

# 主要空港の概算座標（モック用の距離計算）
MOCK_COORDS = {
    'HND': (35.55, 139.78), 'NRT': (35.76, 140.39), 'KIX': (34.43, 135.24), 'ITM': (34.79, 135.44), 'NGO': (34.86, 136.81), 'FUK': (33.59, 130.45), 'CTS': (42.78, 141.69), 'OKA': (26.20, 127.65),
    'TPE': (25.08, 121.23), 'SIN': (1.36, 103.99), 'BKK': (13.69, 100.75), 'HAN': (21.22, 105.81), 'SGN': (10.82, 106.65), 'ICN': (37.46, 126.44), 'PEK': (40.08, 116.58), 'PVG': (31.14, 121.81), 'HKG': (22.31, 113.91), 'KUL': (2.75, 101.71),
    'FRA': (50.03, 8.57), 'MUC': (48.35, 11.79), 'ZRH': (47.46, 8.55), 'VIE': (48.11, 16.57), 'IST': (41.26, 28.74), 'HEL': (60.32, 24.96), 'LHR': (51.47, -0.46), 'CDG': (49.01, 2.55), 'MXP': (45.63, 8.72), 'LIN': (45.45, 9.28), 'DOH': (25.27, 51.61),
    'ADD': (8.98, 38.80), 'CAI': (30.12, 31.41), 'JNB': (-26.14, 28.25), 'NBO': (-1.32, 36.93), 'CPT': (-33.97, 18.60), 'BRU': (50.90, 4.48), 'LIS': (38.77, -9.13), 'WAW': (52.17, 20.97), 'ATH': (37.94, 23.94), 'MAD': (40.47, -3.56), 'MIA': (25.80, -80.29), 'MEX': (19.44, -99.07),
    'GRU': (-23.43, -46.47), 'GIG': (-22.81, -43.25), 'EZE': (-34.82, -58.54), 'SCL': (-33.39, -70.79), 'LIM': (-12.02, -77.11), 'BOG': (4.70, -74.15), 'PTY': (9.07, -79.38), 'UIO': (-0.13, -78.36), 'SJO': (9.99, -84.21), 'IAH': (29.98, -95.34), 'IAD': (38.95, -77.46), 'DEN': (39.86, -104.67), 'EWR': (40.69, -74.17),
    'YVR': (49.19, -123.18), 'YYZ': (43.68, -79.63), 'LAX': (33.94, -118.41), 'SFO': (37.62, -122.38), 'DFW': (32.90, -97.04), 'ORD': (41.97, -87.91), 'JFK': (40.64, -73.78), 'HNL': (21.32, -157.92), 'SYD': (-33.95, 151.18), 'MEL': (-37.67, 144.84), 'AKL': (-37.01, 174.79), 'BNE': (-27.38, 153.12),
}
def mock_distance(a, b):
    import math
    if a not in MOCK_COORDS or b not in MOCK_COORDS:
        return 1500
    (la1, lo1), (la2, lo2) = MOCK_COORDS[a], MOCK_COORDS[b]
    p1, p2 = math.radians(la1), math.radians(la2); dl = math.radians(lo2 - lo1)
    d = math.acos(max(-1, min(1, math.sin(p1) * math.sin(p2) + math.cos(p1) * math.cos(p2) * math.cos(dl))))
    return int(d * 3958.8)

# モック用: 空港 → 代表的な運航会社コード（便名の頭に使う）
MOCK_CARRIER = {'TPE': 'BR', 'SIN': 'SQ', 'BKK': 'TG', 'HAN': 'VN', 'SGN': 'VN', 'ICN': 'OZ', 'PEK': 'CA', 'PVG': 'CA', 'FRA': 'LH', 'MUC': 'LH', 'ZRH': 'LX', 'VIE': 'OS', 'IST': 'TK', 'YVR': 'AC', 'YYZ': 'AC', 'AKL': 'NZ', 'IAH': 'UA', 'EWR': 'UA', 'PTY': 'CM', 'BOG': 'AV', 'ADD': 'ET', 'CAI': 'MS', 'BRU': 'SN', 'LIS': 'TP', 'WAW': 'LO', 'ATH': 'A3', 'MAD': 'IB', 'MIA': 'AA', 'MEX': 'NH', 'IAD': 'UA', 'DEN': 'UA', 'SFO': 'UA',
                'DOH': 'QR', 'HEL': 'AY', 'HKG': 'CX', 'LHR': 'BA', 'KUL': 'MH', 'SYD': 'QF', 'MEL': 'QF', 'BNE': 'QF', 'DFW': 'AA', 'LAX': 'AA', 'ORD': 'AA'}
JP = {'HND', 'NRT', 'KIX', 'ITM', 'NGO', 'FUK', 'CTS', 'OKA'}

def mock_response(q):
    """ダミー応答。実 API と同じ形（AvailabilityTrips / Route.Distance 付き）で、画面を試せる程度の空席を返す。"""
    origins = (q.get('origin_airport', [''])[0] or 'HND').split(',')
    dests = (q.get('destination_airport', [''])[0] or 'TPE').split(',')
    cabin = (q.get('cabins', ['economy'])[0] or 'economy').split(',')[0]
    start = datetime.date.fromisoformat(q.get('start_date', [str(datetime.date.today())])[0])
    end = datetime.date.fromisoformat(q.get('end_date', [str(start)])[0])
    data = []
    d = start
    while d <= end:
        for o in origins:
            for t in dests:
                if o == t:
                    continue
                rnd = random.Random(f'{o}{t}{d}{cabin}')
                if rnd.random() > (0.35 if cabin == 'business' else 0.7):
                    continue
                dist = mock_distance(o, t)
                hub = t if o in JP else o
                car = MOCK_CARRIER.get(hub) or MOCK_CARRIER.get(t) or MOCK_CARRIER.get(o) or 'NH'
                if o in JP and t in JP:
                    car = 'NH'
                trips = []
                for k in range(rnd.randint(1, 2)):
                    dep_h = rnd.choice([1, 9, 11, 17, 22]) + k
                    dur = max(90, int(dist / 8.5) + 40)
                    dep = datetime.datetime.combine(d, datetime.time(dep_h % 24, rnd.choice([0, 25, 50])))
                    arr = dep + datetime.timedelta(minutes=dur)
                    seats = rnd.choice([1, 2, 2, 3, 4, 9]) if cabin != 'economy' else rnd.choice([2, 4, 6, 9])
                    trips.append({'ID': f'mock-{o}-{t}-{d}-{k}', 'Cabin': cabin, 'Stops': 0, 'FlightNumbers': f'{car}{rnd.randint(10, 999)}', 'UpdatedAt': (datetime.datetime.utcnow() - datetime.timedelta(hours=rnd.choice([1, 5, 30, 100]))).strftime('%Y-%m-%dT%H:%M:%SZ'),
                                  'DepartsAt': dep.strftime('%Y-%m-%dT%H:%M:00'), 'ArrivesAt': arr.strftime('%Y-%m-%dT%H:%M:00'), 'RemainingSeats': seats,
                                  'Aircraft': [rnd.choice(['Boeing 787-9', 'Airbus A350-900', 'Boeing 777-300ER', 'Airbus A321neo'])], 'MileageCost': 50000, 'TotalTaxes': 5000, 'TaxesCurrency': 'USD', 'Source': 'united'})
                data.append({'ID': f'mock-{o}-{t}-{d}', 'Date': str(d), 'Route': {'OriginAirport': o, 'DestinationAirport': t, 'Source': 'united', 'Distance': dist}, 'Source': 'united',
                             'YAvailable': cabin == 'economy', 'JAvailable': cabin == 'business', 'AvailabilityTrips': trips})
        d += datetime.timedelta(days=1)
    return {'data': data, 'count': len(data), 'hasMore': False, 'cursor': 0, 'mock': True}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write('%s %s\n' % (self.address_string(), fmt % args))

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        if any(part.startswith('.') for part in urllib.parse.unquote(u.path).split('/') if part):
            return self.send_json(404, {'error': 'not found'})
        if u.path == '/api/ping':
            return self.send_json(200, {'ok': True, 'hasKey': bool(load_key()), 'mock': os.environ.get('SEATS_AERO_MOCK') == '1'})
        if u.path == '/api/search':
            q = urllib.parse.parse_qs(u.query)
            if os.environ.get('SEATS_AERO_MOCK') == '1':
                return self.send_json(200, mock_response(q))
            key = load_key()
            if not key:
                return self.send_json(401, {'error': 'SEATS_AERO_KEY が設定されていません。環境変数か .seats_aero_key ファイルにキーを置いてください。'})
            req = urllib.request.Request(API + '?' + u.query, headers={'Partner-Authorization': key, 'Accept': 'application/json', 'User-Agent': 'ana-award-planner/1.0'})
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    body = r.read()
                    self.send_response(r.status)
                    for hk, hv in r.headers.items():  # 残回数などのヘッダーがあればそのまま渡す
                        if 'ratelimit' in hk.lower() or 'rate-limit' in hk.lower():
                            self.send_header(hk, hv)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Content-Length', str(len(body)))
                    self.send_header('Cache-Control', 'no-store')
                    self.end_headers()
                    self.wfile.write(body)
            except urllib.error.HTTPError as e:
                return self.send_json(e.code, {'error': f'seats.aero HTTP {e.code}: {e.read().decode("utf-8", "ignore")[:300]}'})
            except Exception as e:  # noqa
                return self.send_json(502, {'error': f'seats.aero への接続に失敗: {e}'})
            return
        if u.path == '/':
            self.path = '/index.html'
        return super().do_GET()

    def end_headers(self):
        if self.path.endswith(('.js', '.css', '.html')):
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

if __name__ == '__main__':
    print(f'ANA特典航空券プランナー: http://127.0.0.1:{PORT}/  (APIキー: {"あり" if load_key() else "なし"}{" / MOCK" if os.environ.get("SEATS_AERO_MOCK") == "1" else ""})')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
