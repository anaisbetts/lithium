import * as IsomorphicWebSocket from 'isomorphic-ws';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { empty, Observable, Observer, of, throwError, Subscription } from 'rxjs';
import { filter, flatMap, take } from 'rxjs/operators';

// tslint:disable-next-line:no-var-requires
const d = require('debug')('ha-lithium:websocket');

interface WebSocketExtensions {
  auth(password: string): Promise<boolean>;
  connect(): Subscription;
  call(content: any): Promise<any>;
  listen(eventType?: string): Observable<any>;
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

  ret.connect = function(): Subscription {
    const ret = this.subscribe();

    // Calling unsubscribe() on the top-level connect() should tear it all down
    ret.add(this);
    return ret;
  };

  ret.call = function(content: any) {
    const currentSeq = sequence;
    const promiseRet = this.pipe(
      filter((x: any) => x.id === currentSeq),
      flatMap((x: any) => {
        if (x.success !== true) {
          return throwError(`Failed call: ${JSON.stringify(x)}`);
        } else {
          delete x.id;
          return of(x);
        }
      }),
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

  ret.listen = function(eventType?: string): Observable<any> {
    return Observable.create((subj: Observer<any>) => {
      let opts: any = {
        type: 'subscribe_events'
      };
      const currentSeq = sequence;
      const disp = new Subscription();

      if (eventType) { opts.event_type = eventType; }

      d(`Setting up subscriptions for event: ${eventType || 'all'}`);
      this.call(opts).then((_: any) => {
        disp.add(async () => {
          try {
            d(`Unsubscribing for event: ${eventType || 'all'}`);
            await this.call({type: 'unsubscribe_events', subscription: currentSeq});
          } catch (e) {
            d(`Failed to unsubscribe`);
            d(e.message);
          }
        });

        disp.add(this.pipe(flatMap((x: any) => {
          if (x.id !== currentSeq) { return empty(); }

          delete x.id;
          return of(x);
        })).subscribe(subj));
      }, (err: Error) => {
        disp.unsubscribe();
        subj.error(err);
      });

      return disp;
    });
  };

  return ret;
}