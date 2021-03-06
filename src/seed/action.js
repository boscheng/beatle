import {encodeActionType, decodeActionType, typeToAction} from './actionType';
import Ajax from '../utils/ajax';
import isPlainObject from '../core/isPlainObject';
import isGenerator from './isGenerator';
import messages from '../core/messages';
import warning from 'fbjs/lib/warning';
import BaseModel from '../damo/baseModel';
import reducerImmediate from './reducerImmediate';

/**
 * bindings = ['model'], flattern = false
 * => {model: xxx}
 * bindings = ['model.state'], flattern = false
 * => {model: xxx}
 * bindings = ['model.actions'], flattern = false
 * => {model: xxx}
 * bindings = ['model.state.name'], flattern = false
 * => {model: xxx}
 * bindings = [{name: 'model.state.name'}], flattern = false|true
 * => {name: xxx}
 * bindings = [{name: {test: 1}}], flattern = false|true
 * => {name: {test: 1}}
 */
function getStateByModel(redux, binding, flattern, wrappers, attrKey) {
  const keys = binding.split('.');
  const modelName = keys.shift();
  attrKey = attrKey || modelName;
  const model = {
    state: redux.state[modelName] || {},
    actions: redux.actions[modelName] || {}
  };
  let iState;
  let wrapper;
  let name;
  const cate = keys[0];
  if (keys.length) {
    wrapper = wrappers[cate];
    if (wrapper) {
      iState = wrapper(model[keys.shift()]);
      name = keys.shift();
      while (name) {
        iState = iState[name];
        name = keys.shift();
      }
    } else if (!model[cate] && redux[cate]) {
      // support global function
      flattern = true;
      iState = {
        [cate]: redux[cate].bind(null, modelName)
      };
    }
  } else {
    iState = {};
    Object.keys(wrappers).forEach(name => {
      wrapper = wrappers[name];
      Object.assign(iState, wrapper(model[name]));
    });
  }
  if (flattern) {
    return iState;
  } else {
    return {
      [attrKey]: iState
    };
  }
}

export function getStateByModels(redux, bindings, flattern, wrappers, cacheMap) {
  let stateProps = {};
  let keys;
  let mState;
  try {
    bindings.forEach((binding) => {
      if (typeof binding === 'string') {
        if (!cacheMap[binding]) {
          mState = getStateByModel(redux, binding, flattern, wrappers);
          if (mState && !mState[binding]) {
            cacheMap[binding] = true;
          }
        }
      } else {
        mState = {};
        for (let modelName in binding) {
          if (!cacheMap[modelName]) {
            if (Object(binding[modelName]) === binding[modelName]) {
              mState[modelName] = binding[modelName];
            } else if (typeof binding[modelName] === 'string') {
              Object.assign(mState, getStateByModel(redux, binding[modelName], false, wrappers, modelName));
            }
            if (mState[modelName] === undefined) {
              delete mState[modelName];
            } else {
              cacheMap[modelName] = true;
            }
          }
        }
      }
      Object.assign(stateProps, mState);
    });
  } catch (e) {
    warning(false, messages.selectError, 'select', keys, 'seed', 'Beatle');
    window.console.error(e);
  }
  return stateProps;
}

export function getActionsByDispatch(actions, dispatch) {
  const actionCreators = {};
  for (let name in actions) {
    actionCreators[name] = (...args) => {
      const result = actions[name].apply(null, args);
      if (result && result.then) {
        return result;
      } else if (typeof result === 'function') {
        return result(dispatch);
      } else if (result !== undefined) {
        return dispatch(result);
      }
    };
  }
  return actionCreators;
}

export function setReducers(model, modelName, actionName, actionCfg, async) {
  const callback = typeof actionCfg === 'function' ? actionCfg : actionCfg.reducer || actionCfg.callback || noop;
  let type;
  if (typeof callback === 'function') {
    type = async ? encodeActionType(modelName, actionName, 'success') : encodeActionType(modelName, actionName);
    model._reducers[type] = callback;
  } else {
    for (let status  in callback) {
      if (typeof callback[status] === 'function') {
        type = encodeActionType(modelName, actionName, status);
        model._reducers[type] = callback[status];
      }
    }
  }
}
/**
 * # action构建器
 *
 * + 参数1: option
 *  * modelName - 数据模型的实例名
 *  * model - 数据模型
 *  * resource - 要映射的接口资源
 * + 参数2: fetch
 *  * 接口调用模块，不强制依赖于ajax
 */
export function getActions({
  modelName,
  model,
  resource,
  initialState
}, seed) {
  const saga = seed._saga;
  const fetch = seed._ajax || new Ajax();

  model.ACTION_TYPE_IMMEDIATE = encodeActionType(modelName, '@@UPDATE_STATE');
  model._reducers = {
    [model.ACTION_TYPE_IMMEDIATE]: (nextStore, payload) => reducerImmediate(nextStore, payload, modelName)
  };
  if (model.reducers) {
    for (let key in model.reducers) {
      model._reducers[encodeActionType(modelName, key)] = model.reducers[key];
    }
  }
  /**
   * ### 数据模型内的副作用
   *
   * > 数据模型内副作用中callback、reducer兼容
   * > 跨数据模型副作用中subscriptions，externalReducers兼容
   */
  // 把reducers提前注入进去
  for (let actionName in model.reducers) {
    setReducers(model, modelName, actionName, {reducer: model.reducers[actionName]});
  }
  const subscriptions = model.subscriptions || model.externalReducers;
  const externalReducerKeys = Object.keys(subscriptions || {});
  /**
   * ### 跨数据模型之间的副作用
   *
   * ```
   *  const ModalA = {
   *    displayName: 'modelA',
   *    ...
   *    actions: {
   *      getUser: {
   *        exec,
   *        callback
   *      }
   *    }
   *  }
   *  const ModelB = {
   *    ...
   *    subscriptions: {
   *      'modelA.getUser.success': (modelB_nextStore, modelA_getUser_payload) => {
   *        // 返回值会更新到ModelB的store， 如果是promise那么会接受最终处理值
   *      }
   *    }
   *  }
   *  const ModelC = {
   *    ...
   *    subscriptions: {
   *      'modelA.getUser.success': (modelC_nextStore, modelA_getUser_payload) => {
   *        // 返回值会更新到ModelB的store
   *      }
   *    }
   *  }
   * ```
   */
  externalReducerKeys.forEach((rk) => {
    let names = rk.split('.');
    let moduleName = names[0];
    let actionName = names[1];
    let statusName;
    let isAsyncAction = (names.length === 3);
    if (isAsyncAction) {
      statusName = names[2];
    }
    let type = '';
    if (!isAsyncAction) {
      type = encodeActionType(moduleName, actionName);
      model._reducers[type] = subscriptions[rk];
    } else {
      if (typeof subscriptions[rk] === 'function') {
        type = encodeActionType(moduleName, actionName, statusName);
        model._reducers[type] = subscriptions[rk];
      } else if (typeof subscriptions[rk] === 'object') {
        let reducer = subscriptions[rk];
        for (let status in reducer) {
          if (typeof reducer[status] === 'function') {
            type = encodeActionType(moduleName, actionName, status);
            model._reducers[type] = reducer[status];
          }
        }
      }
    }
  });

  const actions = model.actions || {};
  model.actions = {};
  model._actions = model._actions || {};
  if (model instanceof BaseModel) {
    const keys = Object.getOwnPropertyNames(model.__proto__);
    for (let i = 1, len = keys.length; i < len; i++) {
      if (typeof model[keys[i]] === 'function') {
        model.actions[keys[i]] = model[keys[i]].bind(model);
      }
    }
  }

  // #! 大有用处：设置更新版本
  model.__setIncrement = () => {
    seed.increment();
  };
  model.effects = model.effects || {};

  Object.keys(actions).forEach((actionKey) => {
    // 严格判断存在属性
    if (Object.prototype.hasOwnProperty.call(actions, actionKey)) {
      /**
       * ### action转为reducer后的执行逻辑
       *
       * action分2种，同步和异步的，区分取决于是否存在exec函数
       *
       * ```
       *  // 异步的action，在callback由3中状态的回调
       *  action = {
       *    exec,
       *    callback: {
       *      start,
       *      success,
       *      error
       *    }
       *  }
       *  // 同步action，callback及时回调函数
       *  action = {
       *    callback
       *  }
       * ```
       *
       * + 对于action调用时传参问题如何使用，可以参考下面同步action的使用（异步action也是如此）
       *
       * ```
       *  // 在组件中使用action
       *  this.props.action(1, 2);
       *  // action定义
       *  action = {
       *    callback: (nextStore, payload) => {
       *      // arguments = [1, 2];
       *      // payload = {data, arguments, type, store, message}
       *      nextStore.data = payload.arguments[0];
       *    }
       *  }
       * ```
       *
       * > payload是数据装载器，对于同步的action，data属性不会有值，data值只会接受异步action处理的结果值。arguments永远为action被调用时的传参
       */

      // 处理processor
      const actionCfg = actions[actionKey];
      if (actionCfg._processor) {
        return actionCfg._processor;
      }

      /**
       * ### Model联合Resource生成action
       *
       * 合并action的逻辑是：变量Resource，每个属性propName对应的值prop是一个接口调用配置或者函数，这个值会到Model.actions[propName]附加到exec属性中。并且都当做为异步action来处理
       *
       * ```
       *  // 异步步action，存在exec
       *  // 场景1：exec为接口配置
       *  {
       *    exec: {
       *      url,
       *      method,
       *      callback
       *    },
       *    calback: {
       *      start(){},
       *      success(){},
       *      error(){}
       *    }
       *  }
       *  // 场景1：exec为函数
       *  {
       *    exec: (data) => {
       *      return app.ajax({
       *        url: url,
       *        data: data.
       *        method: 'GET'
       *      })
       *    }
       *  }
       *  // 场景2： exec任意非纯对象
       *  {
       *    exec: Promise.resolve(1)
       *  }
       *  // 同步action
       *  {
       *   callback: (nextStore, payload) => {
       *   }
       *  }
       * ```
       *
       * > 实际上action的配置，只要存在exec属性，就认为是移动的action
       */
      const exec = actionCfg.exec || resource && resource[actionKey];
      if (exec) {
        // #! 异步action
        setReducers(model, modelName, actionKey, actionCfg, true);
        actionCfg._processor = model.actions[actionKey] = getProcessorByExec(model, initialState, modelName, actionKey, exec, fetch, exec.noDispatch);
      } else {
        setReducers(model, modelName, actionKey, actionCfg);
        if (isGenerator(actionCfg)) {
          model.effects[actionKey] = actionCfg;

          actionCfg._processor = model.actions[actionKey] = getProcessorByGenerator(model, initialState, modelName, actionKey, saga);
        } else {
          actionCfg._processor = model.actions[actionKey] = getProcessor(model, initialState, modelName, actionKey, actionCfg, () => seed.getStore().getState()[modelName]);
        }
      }
      Object.defineProperty(actions, actionKey, {
        get: () => {
          return (...args) => model.actions[actionKey].apply(model, args)(model.dispatch);
        },
        enumerable: false
      });
    }
  });

  // 存在effect时走saga
  if (Object.keys(model.effects).length) {
    saga.effect(model);
  }

  return model.actions;
}

function noop() {}

export function getProcessorByExec(model, initialState, modelName, actionName, exec, fetch, noDispatch) {
  return (...args) => {
    return (dispatch) => {
      if (args[args.length - 1] === false) {
        noDispatch = true;
        args.pop();
      }
      const statusMap = {
        start: encodeActionType(modelName, actionName, 'start'),
        success: encodeActionType(modelName, actionName, 'success'),
        error: encodeActionType(modelName, actionName, 'error')
      };

      const promise = new Promise((resolve, reject) => {
        const errorCallback = function (error) {
          if (!noDispatch) {
            dispatch({type: statusMap.error, error: true, payload: {data: undefined, store: initialState, arguments: args, message: error.message, exec: exec}});
          }
          reject(error);
        };
        const successCallback = function (data) {
          if (data instanceof Error) {
            errorCallback(data);
          } else {
            if (!noDispatch) {
              dispatch({type: statusMap.success, payload: {data: data, store: initialState, arguments: args, exec: exec}});
            }
            resolve(data);
          }
        };

        let result;
        if (typeof exec === 'function') {
          result = exec.apply(model, args);
        } else if (isPlainObject(exec)) {
          // #! 保留之前的逻辑，这里是否继续优化
          const option = Object.assign({
            data: exec.data ? Object.assign({}, exec.data, args[0]) : args[0]
          }, args[1] || {});
          for (let key in option) {
            if (option[key] === undefined) {
              delete option[key];
            }
          }
          result = fetch.request(Object.assign({}, exec, option));
        } else {
          result = exec;
        }

        // #! is promise
        if (result && result.then) {
          result.then(successCallback, errorCallback);
        } else {
          successCallback(result);
        }

        return result;
      });
      // 添加一个promise，用于识别异步
      if (!noDispatch) {
        dispatch({type: statusMap.start, payload: {data: undefined, store: initialState, arguments: args, exec: exec, promise: promise}});
      }

      return promise;
    };
  };
}

export function getProcessorByGenerator(model, initialState, modelName, actionName, saga, noDispatch) {
  return (...args) => {
    return (dispatch) => {
      if (args[args.length - 1] === false) {
        noDispatch = true;
        args.pop();
      }
      if (noDispatch) {
        return model.actions[actionName].apply(model, ...args);
      } else {
        const actionKey = typeToAction(modelName, actionName);
        dispatch({
          action: actionKey,
          payload: {
            arguments: args,
            store: initialState
          }
        });
        const type = encodeActionType(modelName, actionName);
        return saga._getWatchPromise(type);
      }
    };
  };
}

export function getProcessor(model, initialState, modelName, actionName, func, getState, noDispatch) {
  return (...args) => {
    return (dispatch) => {
      if (args[args.length - 1] === false) {
        noDispatch = true;
        args.pop();
      }
      // 兼容之前副作用
      if (typeof func === 'function') {
        let isReducer = true;
        const showDispatch = action => {
          if (!noDispatch) {
            dispatch(action);
            noDispatch = true;
          }
        };
        const newDispatch = (action) => {
          isReducer = false;
          if (action.type) {
            const [modelName, name] = decodeActionType(action.type);
            if (!name || !model.actions[modelName]) {
              // #! type指向model中的action
              action.type = encodeActionType(modelName, action.type);
            }
          } else {
            if (action.name) {
              if (action.name.indexOf('.') === -1) {
                action.name = typeToAction(modelName, action.name);
              }
            } else {
              action = {
                type: model.ACTION_TYPE_IMMEDIATE,
                payload: action
              };
            }
          }
          showDispatch(action);
          return Promise.resolve(action.payload);
        };
        if (!noDispatch) {
          args = args.concat({
            put: newDispatch,
            select: (name, deep) => {
              isReducer = false;
              const modelState = getState();
              warning(!modelState.hasOwnProperty || modelState.hasOwnProperty(name), messages.mergeWarning, 'select', name, modelName, 'Beatle.ReduxSeed');
              return Promise.resolve(modelState[name] && modelState[name].asMutable({deep: deep}));
            }
          });
        }
        const result = func.apply(model, args);

        if (isReducer && result === undefined) {
          // #! 同步action
          dispatch({
            type: encodeActionType(modelName, actionName),
            payload: {
              data: null,
              arguments: args,
              store: initialState
            }
          });
          return Promise.resolve(undefined);
        } else {
          if (result && result.then) {
            result.then((ret) => {
              if (!(ret instanceof Error)) {
                showDispatch({
                  type: model.ACTION_TYPE_IMMEDIATE,
                  payload: ret
                });
              }
            }, () => {
              // handler
            });
            return result;
          } else {
            if (result) {
              showDispatch({
                type: model.ACTION_TYPE_IMMEDIATE,
                payload: result
              });
            }
            return Promise.resolve(result);
          }
        }
      } else if (noDispatch) {
        return Promise.resolve(func && func.data);
      } else {
        // #! 同步action
        dispatch({
          type: encodeActionType(modelName, actionName),
          payload: {
            data: func ? func.data : null,
            arguments: args,
            store: initialState
          }
        });
        return Promise.resolve(undefined);
      }
    };
  };
}
