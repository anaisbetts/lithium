import { concat, defer, empty, from, Observable, of, Subscription } from 'rxjs';
import { flatMap, map, publish, refCount } from 'rxjs/operators';
import { Model, Updatable, MergeStrategy } from '@whenjs/when';

import { create, HomeAssistantSocket } from './websocket';

class StreamUpdatable<T> extends Updatable<T> {
  constructor(stream: Observable<T>, strategy?: MergeStrategy, onRelease?: ((x: Updatable<T>) => void)) {
    let disp: Subscription;

    super(() => {
      disp = stream.subscribe(this.next.bind(this), this.error.bind(this));
      return empty();
    }, strategy, x => {
      if (onRelease) { onRelease(x); }
      disp.unsubscribe();
    });
  }
}

export class HomeAssistant extends Model {
  state: Updatable<any>;
  stateChanges: Observable<any>;
  socket: HomeAssistantSocket;

  constructor(socket: HomeAssistantSocket) {
    super();

    this.socket = socket;

    const stateChanges = concat(
      defer(() => socket.call({type: 'get_states'}).then(x => x.result)).pipe(flatMap(xs => from(xs))),
      this.socket.listen('state_changed').pipe(map((x: any) => {
        return Object.assign({}, { entity_id: x.event.data.entity_id }, x.event.data.new_state);
      })));

    this.stateChanges = stateChanges.pipe(publish(), refCount());

    this.state = new StreamUpdatable(this.stateChanges.pipe(map(x => {
      const ret = {};
      ret[x.entity_id] = x;
      return ret;
    })), 'merge');
  }

  refreshState(): Promise<any[]> {
    const ret = this.socket.call({type: 'get_states'}).then(x => x.result);
    this.state.nextAsync(ret);
    return ret;
  }
}

export class Entity extends Model {
  name: string;
  entityState: Updatable<any>;

  constructor(assistant: HomeAssistant, group: string, name: string) {
    super();

    this.name = name;
    this.entityState = new StreamUpdatable(assistant.stateChanges.pipe(flatMap(stateChange => {
      const id = `${group}.${name}`;
      if (stateChange.entity_id !== id) { return empty(); }

      return of(stateChange);
    })));
  }
}

export class Light extends Entity {
  state: Updatable<string>;
  attributes: Updatable<Object>;

  constructor(assistant: HomeAssistant, name: string) {
    super(assistant, 'light', name);

    this.state = new StreamUpdatable(this.entityState.pipe(map(x => x.state)));
    this.attributes = new StreamUpdatable(this.entityState.pipe(map(x => x.attributes)));
  }
}