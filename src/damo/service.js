import React, {createContext} from 'react';
import warning from 'fbjs/lib/warning';
import logMessages from '../core/messages';
import isEqual from 'lodash/isEqual';
export default function service(providers, Component, {injector, globalInjector, selector}) {
  // + 获取HOC包装的组件的实例 > see:
  // https://github.com/RubaXa/Sortable/issues/713#issuecomment-169668921
  function getParantService(name) {
    return this._reactInternalInstance ? this._reactInternalInstance._context[name] : null;
  }
  // 优先级为：providers -> context -> parentContext -> globalService
  function getService(name) {
    const service = this._services && this._services[name] || this.context[name];
    return service || getParantService.call(this, name) || injector.getService(name) || globalInjector.getService(name);
  }

  class NewComponent extends Component {
    static displayName = Component.displayName || Component.name;
    static childContext = createContext();

    constructor(props, context) {
      super(props, context);
      const services = this._services = {};
      if (selector) {
        services.selector = selector;
      }

      if (Array.isArray(providers)) {
        providers.forEach(Provider => {
          warning(Provider.displayName, logMessages.displayName, 'contructor', 'service', 'Beatle');
          services[Provider.displayName] = injector.instantiate(Provider, Provider.displayName, getService.bind(this));
        });
      } else {
        for (let name in providers) {
          services[name] = injector.instantiate(providers[name], name, getService.bind(this));
        }
      }

      if (context.selector) {
        services.parentSelector = context.selector;
        context.selector = selector;
      }
      // 提升当前组件的context的优先级
      for (let name in context) {
        if (services[name] !== undefined) {
          context[name] = services[name];
        }
      }

      if (selector) {
        // context也从当前组件同一个级别
        for (let name in selector.context) {
          if (name === 'props') {
            // 每次获取props都是最新的
            Object.defineProperty(selector.context, 'props', {
              get: () => {
                return this.props;
              },
              enumerable: true,
              configurable: true
            });
          } else {
            selector.context[name] = getService.call(this, name);
          }
        }

        if (selector.hookActions) {
          // hack react-redux 6.x
          // see: https://github.com/reduxjs/react-redux/blob/fa5857281a37545c7c036fb2499159b865b1c57d/src/components/connectAdvanced.js
          /* eslint-disable react/prop-types */
          const empty = {};
          this._state = this.props.location && this.props.location.state || empty;
          const selectChildElement = this.selectChildElement;
          this.selectChildElement = (derivedProps, forwardedRef) => {
            const state = derivedProps.location && derivedProps.location.state || empty;
            if (this._state !== state && !isEqual(this._state, state)) {
              this._hookProps = null;
              this._state = state;
            }
            if (!this._hookProps) {
              this._hookProps = {};
              selector.hookActions.forEach(action => {
                let model;
                if (typeof action === 'function') {
                  const ret = action(derivedProps, this.context);
                  if (ret !== undefined) {
                    Object.assign(this._hookProps, ret);
                  }
                } else {
                  if (typeof action === 'string') {
                    model = selector.getModel(selector.bindings[0]);
                    const name = action;
                    action = {
                      name: name
                    };
                  } else {
                    model = typeof action.model === 'string' ? selector.getModel(action.model) : action.model || selector.getModel(selector.bindings[0]);
                  }
                  if (model && model[action.name]) {
                    const params = action.getParams ? action.getParams(derivedProps, this.context) : action.params;
                    if (params !== false) {
                      model[action.name](params);
                    }
                  }
                }
              });
            }
            Object.assign(derivedProps, this._hookProps);
            return selectChildElement.call(this, derivedProps, forwardedRef);
          };
        }

        // 完成后触发钩子函数
        try {
          selector.initialize && selector.initialize(this.props);
        } catch (e) {
          window.console.error(e);
        }
      }
    }

    componentWillUnmount() {
      super.componentWillUnmount && super.componentWillUnmount();
      const services = this._services;
      for (let name in services) {
        if (services[name].destroy) {
          services[name].destroy();
        }
        if (services[name].dispose) {
          services[name].dispose();
        }
      }
    }

    render() {
      const children = super.render();
      return (<NewComponent.childContext.Provider value={this._services}>{children}</NewComponent.childContext.Provider>);
    }
  }

  return NewComponent;
}
