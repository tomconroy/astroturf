import classNames from 'classnames';
import camelCase from 'lodash/camelCase';
import React from 'react'; // eslint-disable-line import/no-extraneous-dependencies

const has = Object.prototype.hasOwnProperty;

export function styled(
  type,
  options,
  displayName,
  styles,
  kebabName,
  camelName,
) {
  const componentClassName = has.call(styles, kebabName)
    ? styles[kebabName]
    : styles[camelName];

  const hasModifiers = Object.keys(styles).some(
    className => className !== camelName && className !== kebabName,
  );

  function Styled(props) {
    const childProps = { ...props };

    delete childProps.innerRef;
    childProps.ref = props.innerRef;

    if (hasModifiers) {
      const modifierClassNames = [];

      Object.keys(props).forEach(propName => {
        const propValue = props[propName];

        if (typeof propValue === 'boolean') {
          if (has.call(styles, propName)) {
            if (propValue) {
              modifierClassNames.push(styles[propName]);
            }

            delete childProps[propName];
          } else {
            const camelPropName = camelCase(propName);

            if (has.call(styles, camelPropName)) {
              if (propValue) {
                modifierClassNames.push(styles[camelPropName]);
              }

              delete childProps[propName];
            }
          }
        } else if (
          typeof propValue === 'string' ||
          typeof propValue === 'number'
        ) {
          const propKey = `${propName}-${propValue}`;
          if (has.call(styles, propKey)) {
            modifierClassNames.push(styles[propKey]);

            delete childProps[propName];
          } else {
            const camelPropKey = camelCase(propKey);
            if (has.call(styles, camelPropKey)) {
              modifierClassNames.push(styles[camelPropKey]);

              delete childProps[propName];
            }
          }
        }
      });

      childProps.className = classNames(
        childProps.className,
        componentClassName,
        ...modifierClassNames,
      );
    } else {
      childProps.className = classNames(
        childProps.className,
        componentClassName,
      );
    }

    return React.createElement(type, childProps);
  }

  Styled.displayName = displayName;

  const decorated = React.forwardRef
    ? React.forwardRef((props, ref) => <Styled innerRef={ref} {...props} />)
    : Styled;

  decorated.withComponent = nextType =>
    styled(nextType, displayName, styles, kebabName, camelName);

  return decorated;
}

export default styled;

export const css = () => {
  throw new Error('`css` template literal evaluated at runtime!');
};
