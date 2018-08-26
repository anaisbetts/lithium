import * as IsomorphicWebSocket from 'isomorphic-ws';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { of, throwError } from 'rxjs';
import { filter, flatMap, map, take } from 'rxjs/operators';

interface WebSocketExtensions {
  auth(password: string): Promise<boolean>;
  nextRpc(content: any): Promise<any>;
}

export function create(url: string): WebSocketSubject<any> & WebSocketExtensions {
  const shutUpTypeScript: any = IsomorphicWebSocket;

  let sequence = 1;
  const ret: any = webSocket({
    url,
    serializer: (val: any) => {
      if (val.type === 'auth') { return JSON.stringify(val); }
      return JSON.stringify({
        id: sequence++,
        ...val,
      });
    },
    WebSocketCtor: shutUpTypeScript
  });

  ret.call = function(content: any) {
    const currentSeq = sequence;
    const promiseRet = this.pipe(
      filter((x: any) => x.id === currentSeq),
      map((x: any) => { delete x.id; return x; }),
      take(1))
    .toPromise();

    this.next(content);
    return promiseRet;
  };

  ret.auth = function(password: string) {
    const ret = this.pipe(
      filter((x: any) => x.type !== 'auth_required'),
      flatMap((x: any) => {
        if (x.type === 'auth_ok') { return of(true); }
        return throwError(new Error(`Failed to auth: ${JSON.stringify(x)}`));
      }),
      take(1)
    ).toPromise();

    this.next({type: 'auth', api_password: password});
    return ret;
  };

  return ret;
}