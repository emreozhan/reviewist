import { code } from './code';

export const orderOld = code`
package com.shop.domain.order;

import com.shop.domain.money.Money;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

public class Order {

    private final UUID id;
    private final String customerId;
    private final List<OrderLine> lines = new ArrayList<>();
    private OrderStatus status = OrderStatus.NEW;

    public Order(UUID id, String customerId) {
        this.id = id;
        this.customerId = customerId;
    }

    public UUID id() {
        return id;
    }

    public String customerId() {
        return customerId;
    }

    public List<OrderLine> lines() {
        return Collections.unmodifiableList(lines);
    }

    public void addLine(OrderLine line) {
        lines.add(line);
    }

    public Money getTotal() {
        return lines.stream()
                .map(OrderLine::subtotal)
                .reduce(Money.ZERO, Money::plus);
    }

    public void markPaid() {
        status = OrderStatus.PAID;
    }

    public void cancel() {
        if (status == OrderStatus.SHIPPED) {
            throw new IllegalStateException("Shipped orders cannot be cancelled");
        }
        status = OrderStatus.CANCELLED;
    }

    public OrderStatus status() {
        return status;
    }
}
`;

export const orderNew = code`
package com.shop.domain.order;

import com.shop.domain.money.Money;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import org.springframework.util.Assert;

public class Order {

    private final UUID id;
    private final String customerId;
    private final List<OrderLine> lines = new ArrayList<>();
    private OrderStatus status = OrderStatus.NEW;

    public Order(UUID id, String customerId) {
        Assert.hasText(customerId, "customerId is required");
        this.id = id;
        this.customerId = customerId;
    }

    public UUID id() {
        return id;
    }

    public String customerId() {
        return customerId;
    }

    public List<OrderLine> lines() {
        return Collections.unmodifiableList(lines);
    }

    public void addLine(OrderLine line) {
        lines.add(line);
    }

    public Money totalAmount() {
        return lines.stream()
                .map(OrderLine::subtotal)
                .reduce(Money.ZERO, Money::plus);
    }

    public void markPaid() {
        status = OrderStatus.PAID;
    }

    public void cancel() {
        if (status == OrderStatus.SHIPPED) {
            throw new IllegalStateException("Shipped orders cannot be cancelled");
        }
        status = OrderStatus.CANCELLED;
    }

    public OrderStatus status() {
        return status;
    }
}
`;

const moneyHead = code`
package com.shop.domain.money;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Currency;
import java.util.Objects;

public final class Money {

    public static final Money ZERO = new Money(BigDecimal.ZERO, Currency.getInstance("TRY"));

    private final BigDecimal value;
    private final Currency currency;

    public Money(BigDecimal value, Currency currency) {
        this.value = value.setScale(2, RoundingMode.HALF_EVEN);
        this.currency = currency;
    }

    public BigDecimal value() {
        return value;
    }

    public Currency currency() {
        return currency;
    }

    public long toMinorUnits() {
        return value.movePointRight(2).longValueExact();
    }

    public Money plus(Money other) {
        return new Money(value.add(other.value), currency);
    }

    public Money negate() {
        return new Money(value.negate(), currency);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Money other)) return false;
`;

const moneyTail = code`
    }

    @Override
    public int hashCode() {
        return Objects.hash(value, currency);
    }
}
`;

export const moneyOld = `${moneyHead}        return value.equals(other.value) && currency.equals(other.currency);\n${moneyTail}`;
export const moneyNew = `${moneyHead}        return value.compareTo(other.value) == 0;\n${moneyTail}`;

export const notifierOld = code`
package com.shop.application.notification;

import com.shop.domain.order.OrderEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public abstract class AbstractNotifier {

    private static final Logger log = LoggerFactory.getLogger(AbstractNotifier.class);

    public final void notify(OrderEvent event) {
        String message = format(event);
        send(event.recipient(), message);
        log.debug("Notification sent for order {}", event.orderId());
    }

    protected abstract String format(OrderEvent event);

    protected abstract void send(String recipient, String message);
}
`;

export const notifierNew = code`
package com.shop.application.notification;

import com.shop.domain.order.OrderEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public abstract class AbstractNotifier {

    private static final Logger log = LoggerFactory.getLogger(AbstractNotifier.class);

    public final void notify(OrderEvent event) {
        if (!supports(event)) {
            log.debug("Skipping {} for order {}", getClass().getSimpleName(), event.orderId());
            return;
        }
        String message = format(event);
        try {
            send(event.recipient(), message);
        } catch (RuntimeException e) {
            log.warn("Notification failed for order {}", event.orderId(), e);
        }
    }

    protected boolean supports(OrderEvent event) {
        return event.recipient() != null && !event.recipient().isBlank();
    }

    protected abstract String format(OrderEvent event);

    protected abstract void send(String recipient, String message);
}
`;

export const cancelOrderOld = code`
package com.shop.application;

import com.shop.domain.order.Order;
import com.shop.domain.order.OrderRepository;
import com.shop.domain.payment.PaymentGateway;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class CancelOrderService {

    private final OrderRepository orders;
    private final PaymentGateway payments;

    public CancelOrderService(OrderRepository orders, PaymentGateway payments) {
        this.orders = orders;
        this.payments = payments;
    }

    public void cancel(UUID orderId) {
        Order order = orders.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Unknown order " + orderId));
        order.cancel();
        orders.save(order);
        payments.refund(order.id().toString());
    }
}
`;

export const cancelOrderNew = code`
package com.shop.application;

import com.shop.domain.order.Order;
import com.shop.domain.order.OrderRepository;
import com.shop.domain.payment.PaymentGateway;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CancelOrderService {

    private final OrderRepository orders;
    private final PaymentGateway payments;

    public CancelOrderService(OrderRepository orders, PaymentGateway payments) {
        this.orders = orders;
        this.payments = payments;
    }

    @Transactional
    public void cancel(UUID orderId) {
        Order order = orders.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Unknown order " + orderId));
        order.cancel();
        orders.save(order);
        payments.refund(order.id().toString());
    }
}
`;

export const orderControllerOld = code`
package com.shop.adapter.in.web;

import com.shop.application.PlaceOrderService;
import com.shop.domain.order.Order;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderController {

    private final PlaceOrderService placeOrder;
    private final OrderMapper mapper;

    public OrderController(PlaceOrderService placeOrder, OrderMapper mapper) {
        this.placeOrder = placeOrder;
        this.mapper = mapper;
    }

    @PostMapping("/orders")
    public OrderResponse create(@RequestBody OrderRequest request) {
        Order order = placeOrder.place(mapper.toDomain(request));
        return new OrderResponse(order.id(), order.getTotal().value(), order.status().name());
    }
}
`;

export const orderControllerNew = orderControllerOld.replace('order.getTotal()', 'order.totalAmount()');
